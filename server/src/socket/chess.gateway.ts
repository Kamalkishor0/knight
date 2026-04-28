import { randomUUID } from "node:crypto";
import { Chess, type PieceSymbol } from "chess.js";
import prisma from "../db.js";
import { verifyToken } from "../utils/jwt.js";
import {
  broadcastGameState,
  broadcastOnlineUsers,
  broadcastRoomState,
  extractToken,
  getGameSnapshot,
  getRoomState,
  isUserOnline,
  leaveRoom,
  maybeStartGame,
  normalizeRoomId,
  onlineUsers,
  pendingInvites,
  removeUserFromRoom,
  roomByUserId,
  rooms,
  socketsByUserId,
} from "./chess.state.js";
import type { ChatMessage, MoveResult, Room, TypedServer } from "./chess.types.js";

const INVITE_TTL_MS = 10 * 60 * 1000;
const MATCHMAKING_TIMEOUT_MS = 60 * 1000;
const MATCHMAKING_GAME_START_DELAY_MS = 1500;

type MatchmakingEntry = {
  userId: string;
  username: string;
  expiresAt: number;
};

const matchmakingQueue: MatchmakingEntry[] = [];
const matchmakingTimeoutByUserId = new Map<string, NodeJS.Timeout>();

function cleanupExpiredInvites() {
  const now = Date.now();

  for (const [inviteId, invite] of pendingInvites.entries()) {
    if (now - invite.createdAt > INVITE_TTL_MS) {
      pendingInvites.delete(inviteId);
    }
  }
}

function emitToUser(io: TypedServer, userId: string, event: "matchmaking:status" | "matchmaking:found", payload: unknown) {
  const socketIds = socketsByUserId.get(userId);
  if (!socketIds) {
    return;
  }

  for (const socketId of socketIds) {
    io.to(socketId).emit(event, payload as never);
  }
}

function clearMatchmakingTimeout(userId: string) {
  const timer = matchmakingTimeoutByUserId.get(userId);
  if (!timer) {
    return;
  }

  clearTimeout(timer);
  matchmakingTimeoutByUserId.delete(userId);
}

function removeFromMatchmaking(
  io: TypedServer,
  userId: string,
  options?: { emitStatus?: { status: "timeout" | "cancelled"; message: string } },
) {
  const index = matchmakingQueue.findIndex((entry) => entry.userId === userId);
  if (index !== -1) {
    matchmakingQueue.splice(index, 1);
  }

  clearMatchmakingTimeout(userId);

  if (options?.emitStatus) {
    emitToUser(io, userId, "matchmaking:status", {
      status: options.emitStatus.status,
      message: options.emitStatus.message,
    });
  }
}

function scheduleMatchmakingTimeout(io: TypedServer, entry: MatchmakingEntry) {
  clearMatchmakingTimeout(entry.userId);

  const waitMs = Math.max(0, entry.expiresAt - Date.now());
  const timer = setTimeout(() => {
    const queued = matchmakingQueue.some((item) => item.userId === entry.userId);
    if (!queued) {
      clearMatchmakingTimeout(entry.userId);
      return;
    }

    removeFromMatchmaking(io, entry.userId, {
      emitStatus: {
        status: "timeout",
        message: "No opponent found in 1 minute. Click Play to try again.",
      },
    });
  }, waitMs);

  matchmakingTimeoutByUserId.set(entry.userId, timer);
}

function pullNextMatchmakingCandidate(io: TypedServer): MatchmakingEntry | null {
  while (matchmakingQueue.length > 0) {
    const candidate = matchmakingQueue.shift();
    if (!candidate) {
      return null;
    }

    clearMatchmakingTimeout(candidate.userId);

    const isExpired = candidate.expiresAt <= Date.now();
    if (isExpired) {
      emitToUser(io, candidate.userId, "matchmaking:status", {
        status: "timeout",
        message: "No opponent found in 1 minute. Click Play to try again.",
      });
      continue;
    }

    if (!isUserOnline(candidate.userId) || roomByUserId.has(candidate.userId)) {
      continue;
    }

    return candidate;
  }

  return null;
}

function createMatchRoom(io: TypedServer, first: MatchmakingEntry, second: MatchmakingEntry) {
  removeUserFromRoom(io, first.userId);
  removeUserFromRoom(io, second.userId);

  let roomId = normalizeRoomId();
  while (rooms.has(roomId)) {
    roomId = normalizeRoomId();
  }

  const room: Room = {
    id: roomId,
    players: new Map([
      [first.userId, { userId: first.userId, username: first.username }],
      [second.userId, { userId: second.userId, username: second.username }],
    ]),
  };

  rooms.set(roomId, room);
  roomByUserId.set(first.userId, roomId);
  roomByUserId.set(second.userId, roomId);

  const firstSocketIds = socketsByUserId.get(first.userId);
  if (firstSocketIds) {
    for (const socketId of firstSocketIds) {
      const firstSocket = io.sockets.sockets.get(socketId);
      firstSocket?.join(roomId);
    }
  }

  const secondSocketIds = socketsByUserId.get(second.userId);
  if (secondSocketIds) {
    for (const socketId of secondSocketIds) {
      const secondSocket = io.sockets.sockets.get(socketId);
      secondSocket?.join(roomId);
    }
  }

  const state = getRoomState(room);
  io.to(roomId).emit("room:state", state);

  emitToUser(io, first.userId, "matchmaking:status", {
    status: "matched",
    message: `Match found with ${second.username}. Game starts in a moment...`,
  });
  emitToUser(io, second.userId, "matchmaking:status", {
    status: "matched",
    message: `Match found with ${first.username}. Game starts in a moment...`,
  });

  emitToUser(io, first.userId, "matchmaking:found", {
    roomId,
    opponent: { userId: second.userId, username: second.username },
  });
  emitToUser(io, second.userId, "matchmaking:found", {
    roomId,
    opponent: { userId: first.userId, username: first.username },
  });

  setTimeout(() => {
    maybeStartGame(io, roomId);
  }, MATCHMAKING_GAME_START_DELAY_MS);
}

function attemptMatchmaking(io: TypedServer) {
  while (matchmakingQueue.length >= 2) {
    const first = pullNextMatchmakingCandidate(io);
    if (!first) {
      return;
    }

    const second = pullNextMatchmakingCandidate(io);
    if (!second) {
      matchmakingQueue.unshift(first);
      scheduleMatchmakingTimeout(io, first);
      return;
    }

    createMatchRoom(io, first, second);
  }
}

async function areFriends(userIdA: string, userIdB: string): Promise<boolean> {
  const friendship = await prisma.friendship.findFirst({
    where: {
      status: "ACCEPTED",
      OR: [
        { requesterId: userIdA, addresseeId: userIdB },
        { requesterId: userIdB, addresseeId: userIdA },
      ],
    },
    select: { id: true },
  });

  return Boolean(friendship);
}

const rematchAcceptedByRoomId = new Map<string, Set<string>>();
const drawOfferedByRoomId = new Map<string, string>();
const roomChatByRoomId = new Map<string, ChatMessage[]>();
const lastChatAtByUserId = new Map<string, number>();

const MAX_CHAT_MESSAGES_PER_ROOM = 100;
const MAX_CHAT_LENGTH = 300;
const CHAT_COOLDOWN_MS = 500;

function cleanupChatForDeletedRooms() {
  for (const roomId of roomChatByRoomId.keys()) {
    if (!rooms.has(roomId)) {
      roomChatByRoomId.delete(roomId);
    }
  }
}

function getEndedGameRoom(roomId: string) {
  const room = rooms.get(roomId);
  if (!room || !room.game) {
    return null;
  }

  const snapshot = getGameSnapshot(room);
  if (!snapshot || snapshot.status === "active") {
    return null;
  }

  return room;
}

function getActiveGameRoom(roomId: string) {
  const room = rooms.get(roomId);
  if (!room || !room.game) {
    return null;
  }

  const snapshot = getGameSnapshot(room);
  if (!snapshot || snapshot.status !== "active") {
    return null;
  }

  return room;
}

function startRematch(io: TypedServer, roomId: string) {
  const room = rooms.get(roomId);
  if (!room || !room.game) {
    return false;
  }

  room.game = undefined;
  rematchAcceptedByRoomId.delete(roomId);
  drawOfferedByRoomId.delete(roomId);
  io.to(roomId).emit("game:rematch:status", {
    status: "started",
    message: "Rematch accepted. Starting a new game.",
  });
  maybeStartGame(io, roomId, { skipCountdown: true });
  return true;
}

export function registerChessGateway(io: TypedServer) {
  io.use((socket, next) => {
    const token = extractToken(socket);

    if (!token) {
      next(new Error("Unauthorized"));
      return;
    }

    const payload = verifyToken(token);
    if (!payload) {
      next(new Error("Unauthorized"));
      return;
    }

    socket.data.auth = payload;
    next();
  });

  io.on("connection", (socket) => {
    const { userId, username } = socket.data.auth;

    const userSockets = socketsByUserId.get(userId) ?? new Set<string>();
    userSockets.add(socket.id);
    socketsByUserId.set(userId, userSockets);
    onlineUsers.set(userId, { userId, username });

    const existingRoomId = roomByUserId.get(userId);
    if (existingRoomId) {
      socket.join(existingRoomId);
      broadcastRoomState(io, existingRoomId);
      broadcastGameState(io, existingRoomId);
      maybeStartGame(io, existingRoomId);
    }

    broadcastOnlineUsers(io);

    socket.on("matchmaking:join", (callback) => {
      if (roomByUserId.has(userId)) {
        callback({ ok: false, error: "You are already in a room" });
        return;
      }

      const existing = matchmakingQueue.find((entry) => entry.userId === userId);
      if (existing) {
        callback({ ok: true, data: { status: "searching", expiresAt: existing.expiresAt } });
        return;
      }

      const entry: MatchmakingEntry = {
        userId,
        username,
        expiresAt: Date.now() + MATCHMAKING_TIMEOUT_MS,
      };

      matchmakingQueue.push(entry);
      scheduleMatchmakingTimeout(io, entry);

      emitToUser(io, userId, "matchmaking:status", {
        status: "searching",
        message: "Searching for an opponent...",
        expiresAt: entry.expiresAt,
      });

      callback({ ok: true, data: { status: "searching", expiresAt: entry.expiresAt } });
      attemptMatchmaking(io);
    });

    socket.on("matchmaking:cancel", (callback) => {
      const isQueued = matchmakingQueue.some((entry) => entry.userId === userId);
      if (!isQueued) {
        callback({ ok: false, error: "You are not in matchmaking" });
        return;
      }

      removeFromMatchmaking(io, userId, {
        emitStatus: {
          status: "cancelled",
          message: "Matchmaking cancelled.",
        },
      });

      callback({ ok: true });
    });

    socket.on("room:create", (payload, callback) => {
      removeFromMatchmaking(io, userId);

      if (roomByUserId.has(userId)) {
        callback({ ok: false, error: "You are already in a room" });
        return;
      }

      let roomId = normalizeRoomId(payload?.roomId);
      while (rooms.has(roomId)) {
        roomId = normalizeRoomId();
      }

      const room: Room = {
        id: roomId,
        players: new Map([[userId, { userId, username }]]),
      };

      rooms.set(roomId, room);
      roomByUserId.set(userId, roomId);
      socket.join(roomId);

      const state = getRoomState(room);
      io.to(roomId).emit("room:state", state);
      callback({ ok: true, data: state });

      maybeStartGame(io, roomId);
    });

    socket.on("room:join", ({ roomId }, callback) => {
      removeFromMatchmaking(io, userId);

      const normalizedRoomId = normalizeRoomId(roomId);
      const room = rooms.get(normalizedRoomId);

      if (!room) {
        callback({ ok: false, error: "Room not found" });
        return;
      }

      const currentRoomId = roomByUserId.get(userId);
      if (currentRoomId && currentRoomId !== normalizedRoomId) {
        callback({ ok: false, error: "Leave your current room first" });
        return;
      }

      if (!room.players.has(userId) && room.players.size >= 2) {
        callback({ ok: false, error: "Room is full" });
        return;
      }

      room.players.set(userId, { userId, username });
      roomByUserId.set(userId, normalizedRoomId);
      socket.join(normalizedRoomId);

      const state = getRoomState(room);
      io.to(normalizedRoomId).emit("room:state", state);
      callback({ ok: true, data: state });

      maybeStartGame(io, normalizedRoomId);
    });

    socket.on("room:state", (callback) => {
      const roomId = roomByUserId.get(userId);
      if (!roomId) {
        callback({ ok: false, error: "You are not in a room" });
        return;
      }

      const room = rooms.get(roomId);
      if (!room) {
        roomByUserId.delete(userId);
        callback({ ok: false, error: "Room no longer exists" });
        return;
      }

      callback({ ok: true, data: getRoomState(room) });
    });

    socket.on("game:state", (callback) => {
      const roomId = roomByUserId.get(userId);
      if (!roomId) {
        callback({ ok: false, error: "You are not in a room" });
        return;
      }

      const room = rooms.get(roomId);
      if (!room) {
        roomByUserId.delete(userId);
        callback({ ok: false, error: "Room no longer exists" });
        return;
      }

      const snapshot = getGameSnapshot(room);
      if (!snapshot) {
        callback({ ok: false, error: "Game not started" });
        return;
      }

      callback({ ok: true, data: snapshot });
    });

    socket.on("chat:history", (callback) => {
      cleanupChatForDeletedRooms();

      const roomId = roomByUserId.get(userId);
      if (!roomId) {
        callback({ ok: false, error: "You are not in a room" });
        return;
      }

      const room = rooms.get(roomId);
      if (!room) {
        roomByUserId.delete(userId);
        roomChatByRoomId.delete(roomId);
        callback({ ok: false, error: "Room no longer exists" });
        return;
      }

      const messages = roomChatByRoomId.get(roomId) ?? [];
      callback({ ok: true, data: { messages } });
    });

    socket.on("chat:send", (payload, callback) => {
      cleanupChatForDeletedRooms();

      const roomId = roomByUserId.get(userId);
      if (!roomId) {
        callback({ ok: false, error: "You are not in a room" });
        return;
      }

      const payloadRoomId = payload.roomId?.trim().toUpperCase();
      if (payloadRoomId && payloadRoomId !== roomId) {
        callback({ ok: false, error: "Invalid room" });
        return;
      }

      const room = rooms.get(roomId);
      if (!room || !room.players.has(userId)) {
        callback({ ok: false, error: "Room not found" });
        return;
      }

      const text = payload.text?.trim();
      if (!text) {
        callback({ ok: false, error: "Message cannot be empty" });
        return;
      }

      if (text.length > MAX_CHAT_LENGTH) {
        callback({ ok: false, error: `Message too long (max ${MAX_CHAT_LENGTH} characters)` });
        return;
      }

      const now = Date.now();
      const lastChatAt = lastChatAtByUserId.get(userId) ?? 0;
      if (now - lastChatAt < CHAT_COOLDOWN_MS) {
        callback({ ok: false, error: "You are sending messages too fast" });
        return;
      }

      lastChatAtByUserId.set(userId, now);

      const message: ChatMessage = {
        id: randomUUID(),
        roomId,
        text,
        createdAt: now,
        by: { userId, username },
      };

      const existingMessages = roomChatByRoomId.get(roomId) ?? [];
      existingMessages.push(message);
      if (existingMessages.length > MAX_CHAT_MESSAGES_PER_ROOM) {
        existingMessages.splice(0, existingMessages.length - MAX_CHAT_MESSAGES_PER_ROOM);
      }
      roomChatByRoomId.set(roomId, existingMessages);

      io.to(roomId).emit("chat:new", message);
      callback({ ok: true, data: message });
    });

    socket.on("room:leave", (callback) => {
      if (!roomByUserId.has(userId)) {
        callback({ ok: false, error: "You are not in a room" });
        return;
      }

      const roomId = roomByUserId.get(userId);
      if (roomId) {
        rematchAcceptedByRoomId.delete(roomId);
        drawOfferedByRoomId.delete(roomId);
      }

      leaveRoom(io, socket, userId, `${username} left the room`);

      if (roomId && !rooms.has(roomId)) {
        roomChatByRoomId.delete(roomId);
      }

      callback({ ok: true });
    });

    socket.on("chess:move", (payload, callback) => {
      const roomId = roomByUserId.get(userId);
      if (!roomId) {
        callback({ ok: false, error: "You are not in a room" });
        return;
      }

      if (payload.roomId !== roomId) {
        callback({ ok: false, error: "Invalid room" });
        return;
      }

      const room = rooms.get(roomId);
      if (!room || !room.players.has(userId)) {
        callback({ ok: false, error: "Room not found" });
        return;
      }

      if (!room.game) {
        callback({ ok: false, error: "Game not started" });
        return;
      }

      const snapshotBeforeMove = getGameSnapshot(room);
      if (!snapshotBeforeMove || snapshotBeforeMove.status !== "active") {
        broadcastGameState(io, roomId);
        callback({ ok: false, error: "Game is already over" });
        return;
      }

      const playerColor: "w" | "b" | null =
        room.game.whiteUserId === userId ? "w" : room.game.blackUserId === userId ? "b" : null;

      if (!playerColor) {
        callback({ ok: false, error: "You are not a player in this game" });
        return;
      }

      if (room.game.chess.turn() !== playerColor) {
        callback({ ok: false, error: "Not your turn" });
        return;
      }

      const from = payload.from?.trim().toLowerCase();
      const to = payload.to?.trim().toLowerCase();

      if (!from || !to) {
        callback({ ok: false, error: "Move must include from and to squares" });
        return;
      }

      const promotion = payload.promotion as PieceSymbol | undefined;

      let moveResult: ReturnType<Chess["move"]>;
      try {
        moveResult = room.game.chess.move({
          from,
          to,
          promotion,
        });
      } catch {
        callback({ ok: false, error: "Illegal move" });
        return;
      }

      if (!moveResult) {
        callback({ ok: false, error: "Illegal move" });
        return;
      }

      room.game.lastTickAt = Date.now();
      drawOfferedByRoomId.delete(roomId);

      const eventPayload: MoveResult = {
        roomId,
        from,
        to,
        san: moveResult.san,
        fen: room.game.chess.fen(),
        turn: room.game.chess.turn(),
        by: { userId, username },
      };

      io.to(roomId).emit("chess:move", eventPayload);
      callback({ ok: true, data: eventPayload });

      broadcastGameState(io, roomId);
    });

    socket.on("game:rematch:request", (callback) => {
      const roomId = roomByUserId.get(userId);
      if (!roomId) {
        callback({ ok: false, error: "You are not in a room" });
        return;
      }

      const room = getEndedGameRoom(roomId);
      if (!room || !room.game) {
        callback({ ok: false, error: "Rematch is only available after game over" });
        return;
      }

      const isWhite = room.game.whiteUserId === userId;
      const isBlack = room.game.blackUserId === userId;
      if (!isWhite && !isBlack) {
        callback({ ok: false, error: "Only players can request rematch" });
        return;
      }

      const opponentUserId = isWhite ? room.game.blackUserId : room.game.whiteUserId;
      const opponent = room.players.get(opponentUserId);
      if (!opponent) {
        callback({ ok: false, error: "Opponent is no longer in the room" });
        return;
      }

      const accepted = rematchAcceptedByRoomId.get(roomId) ?? new Set<string>();
      accepted.add(userId);
      rematchAcceptedByRoomId.set(roomId, accepted);

      io.to(roomId).emit("game:rematch:status", {
        status: "requested",
        message: `${username} requested a rematch.`,
        by: { userId, username },
      });

      if (!accepted.has(opponentUserId)) {
        const opponentSocketIds = socketsByUserId.get(opponentUserId);
        if (opponentSocketIds) {
          for (const socketId of opponentSocketIds) {
            io.to(socketId).emit("game:rematch:requested", {
              from: { userId, username },
            });
          }
        }

        callback({ ok: true, data: { waitingFor: opponent.username } });
        return;
      }

      const started = startRematch(io, roomId);
      callback({ ok: true, data: { started } });
    });

    socket.on("game:rematch:respond", (payload, callback) => {
      const roomId = roomByUserId.get(userId);
      if (!roomId) {
        callback({ ok: false, error: "You are not in a room" });
        return;
      }

      const room = getEndedGameRoom(roomId);
      if (!room || !room.game) {
        callback({ ok: false, error: "No rematch request to respond to" });
        return;
      }

      const isWhite = room.game.whiteUserId === userId;
      const isBlack = room.game.blackUserId === userId;
      if (!isWhite && !isBlack) {
        callback({ ok: false, error: "Only players can respond to rematch" });
        return;
      }

      if (!payload.accept) {
        rematchAcceptedByRoomId.delete(roomId);
        io.to(roomId).emit("game:rematch:status", {
          status: "declined",
          message: `${username} declined the rematch request.`,
          by: { userId, username },
        });
        callback({ ok: true, data: { started: false } });
        return;
      }

      const accepted = rematchAcceptedByRoomId.get(roomId) ?? new Set<string>();
      accepted.add(userId);
      rematchAcceptedByRoomId.set(roomId, accepted);

      const opponentUserId = isWhite ? room.game.blackUserId : room.game.whiteUserId;
      if (!accepted.has(opponentUserId)) {
        callback({ ok: true, data: { started: false } });
        return;
      }

      const started = startRematch(io, roomId);
      callback({ ok: true, data: { started } });
    });

    socket.on("game:draw:request", (callback) => {
      const roomId = roomByUserId.get(userId);
      if (!roomId) {
        callback({ ok: false, error: "You are not in a room" });
        return;
      }

      const room = getActiveGameRoom(roomId);
      if (!room || !room.game) {
        callback({ ok: false, error: "Draw offer is only available during an active game" });
        return;
      }

      const isWhite = room.game.whiteUserId === userId;
      const isBlack = room.game.blackUserId === userId;
      if (!isWhite && !isBlack) {
        callback({ ok: false, error: "Only players can offer a draw" });
        return;
      }

      const opponentUserId = isWhite ? room.game.blackUserId : room.game.whiteUserId;
      const opponent = room.players.get(opponentUserId);
      if (!opponent) {
        callback({ ok: false, error: "Opponent is no longer in the room" });
        return;
      }

      const existingOfferFrom = drawOfferedByRoomId.get(roomId);
      if (existingOfferFrom === userId) {
        callback({ ok: false, error: "You have already offered a draw" });
        return;
      }

      if (existingOfferFrom === opponentUserId) {
        callback({ ok: false, error: "Respond to the current draw offer first" });
        return;
      }

      drawOfferedByRoomId.set(roomId, userId);

      io.to(roomId).emit("game:draw:status", {
        status: "requested",
        message: `${username} offered a draw.`,
        by: { userId, username },
      });

      const opponentSocketIds = socketsByUserId.get(opponentUserId);
      if (opponentSocketIds) {
        for (const socketId of opponentSocketIds) {
          io.to(socketId).emit("game:draw:requested", {
            from: { userId, username },
          });
        }
      }

      callback({ ok: true, data: { waitingFor: opponent.username } });
    });

    socket.on("game:draw:respond", (payload, callback) => {
      const roomId = roomByUserId.get(userId);
      if (!roomId) {
        callback({ ok: false, error: "You are not in a room" });
        return;
      }

      const room = getActiveGameRoom(roomId);
      if (!room || !room.game) {
        callback({ ok: false, error: "No active draw offer to respond to" });
        return;
      }

      const isWhite = room.game.whiteUserId === userId;
      const isBlack = room.game.blackUserId === userId;
      if (!isWhite && !isBlack) {
        callback({ ok: false, error: "Only players can respond to draw offers" });
        return;
      }

      const offeredBy = drawOfferedByRoomId.get(roomId);
      if (!offeredBy) {
        callback({ ok: false, error: "No pending draw offer" });
        return;
      }

      if (offeredBy === userId) {
        callback({ ok: false, error: "You cannot respond to your own draw offer" });
        return;
      }

      if (!payload.accept) {
        drawOfferedByRoomId.delete(roomId);
        io.to(roomId).emit("game:draw:status", {
          status: "declined",
          message: `${username} declined the draw offer.`,
          by: { userId, username },
        });
        callback({ ok: true, data: { accepted: false } });
        return;
      }

      room.game.agreedDraw = true;
      room.game.lastTickAt = null;
      drawOfferedByRoomId.delete(roomId);

      io.to(roomId).emit("game:draw:status", {
        status: "accepted",
        message: `${username} accepted the draw offer.`,
        by: { userId, username },
      });

      broadcastGameState(io, roomId);
      callback({ ok: true, data: { accepted: true } });
    });

    socket.on("invite:send", async (payload, callback) => {
      cleanupExpiredInvites();
      removeFromMatchmaking(io, userId);

      const toUserId = payload.toUserId?.trim();
      if (!toUserId) {
        callback({ ok: false, error: "Missing target user" });
        return;
      }

      if (toUserId === userId) {
        callback({ ok: false, error: "You cannot invite yourself" });
        return;
      }

      const roomId = payload.roomId ? normalizeRoomId(payload.roomId) : roomByUserId.get(userId);

      const friend = await areFriends(userId, toUserId);
      if (!friend) {
        callback({ ok: false, error: "You can only invite users from your friend list" });
        return;
      }

      if (!isUserOnline(toUserId)) {
        callback({ ok: false, error: "Friend is offline" });
        return;
      }

      const inviteId = randomUUID();
      pendingInvites.set(inviteId, {
        inviteId,
        fromUserId: userId,
        fromUsername: username,
        toUserId,
        createdAt: Date.now(),
      });

      const inviteLink = `${socket.handshake.headers.origin || "http://localhost:3000"}/home?invite=${encodeURIComponent(inviteId)}`;

      const friendSocketIds = socketsByUserId.get(toUserId);
      if (friendSocketIds) {
        for (const socketId of friendSocketIds) {
          io.to(socketId).emit("invite:received", {
            from: { userId, username },
            inviteId,
            roomId: roomId || "",
            inviteLink,
          });
        }
      }

      callback({ ok: true, data: { inviteId, roomId: roomId || undefined, inviteLink } });
    });

    socket.on("invite:accept", async (payload, callback) => {
      cleanupExpiredInvites();

      const inviteId = payload.inviteId?.trim();
      if (!inviteId) {
        callback({ ok: false, error: "Missing invite id" });
        return;
      }

      const invite = pendingInvites.get(inviteId);
      if (!invite) {
        callback({ ok: false, error: "Invite is invalid or expired" });
        return;
      }

      if (invite.toUserId !== userId) {
        callback({ ok: false, error: "This invite is not for you" });
        return;
      }

      if (!isUserOnline(invite.fromUserId)) {
        callback({ ok: false, error: "Friend is offline" });
        return;
      }

      const friend = await areFriends(userId, invite.fromUserId);
      if (!friend) {
        callback({ ok: false, error: "Invite sender is no longer in your friend list" });
        return;
      }

      const inviterUsername = onlineUsers.get(invite.fromUserId)?.username || invite.fromUsername;

      removeFromMatchmaking(io, invite.fromUserId);
      removeFromMatchmaking(io, userId);
      removeUserFromRoom(io, invite.fromUserId);
      removeUserFromRoom(io, userId);

      let roomId = normalizeRoomId();
      while (rooms.has(roomId)) {
        roomId = normalizeRoomId();
      }

      const room: Room = {
        id: roomId,
        players: new Map([
          [invite.fromUserId, { userId: invite.fromUserId, username: inviterUsername }],
          [userId, { userId, username }],
        ]),
      };

      rooms.set(roomId, room);
      roomByUserId.set(invite.fromUserId, roomId);
      roomByUserId.set(userId, roomId);

      const inviterSocketIds = socketsByUserId.get(invite.fromUserId);
      if (inviterSocketIds) {
        for (const socketId of inviterSocketIds) {
          const inviterSocket = io.sockets.sockets.get(socketId);
          inviterSocket?.join(roomId);
        }
      }

      socket.join(roomId);
      pendingInvites.delete(inviteId);

      if (inviterSocketIds) {
        for (const socketId of inviterSocketIds) {
          io.to(socketId).emit("invite:accepted", {
            inviteId,
            roomId,
            acceptedBy: { userId, username },
          });
        }
      }

      const state = getRoomState(room);
      io.to(roomId).emit("room:state", state);
      maybeStartGame(io, roomId);

      callback({ ok: true, data: state });
    });

    socket.on("disconnect", () => {
      removeFromMatchmaking(io, userId);
      lastChatAtByUserId.delete(userId);

      const sockets = socketsByUserId.get(userId);
      if (sockets) {
        sockets.delete(socket.id);
        if (sockets.size === 0) {
          socketsByUserId.delete(userId);
          onlineUsers.delete(userId);
          const currentRoomId = roomByUserId.get(userId);
          if (currentRoomId) {
            broadcastRoomState(io, currentRoomId);
            drawOfferedByRoomId.delete(currentRoomId);
          }
        } else {
          socketsByUserId.set(userId, sockets);
        }
      }

      broadcastOnlineUsers(io);
      cleanupChatForDeletedRooms();
    });
  });
}
