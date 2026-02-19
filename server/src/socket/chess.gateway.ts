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
  roomByUserId,
  rooms,
  socketsByUserId,
} from "./chess.state.js";
import type { MoveResult, Room, TypedServer } from "./chess.types.js";

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

function startRematch(io: TypedServer, roomId: string) {
  const room = rooms.get(roomId);
  if (!room || !room.game) {
    return false;
  }

  room.game = undefined;
  rematchAcceptedByRoomId.delete(roomId);
  io.to(roomId).emit("game:rematch:status", {
    status: "started",
    message: "Rematch accepted. Starting a new game.",
  });
  maybeStartGame(io, roomId);
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
    }

    broadcastOnlineUsers(io);

    socket.on("room:create", (payload, callback) => {
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

    socket.on("room:leave", (callback) => {
      if (!roomByUserId.has(userId)) {
        callback({ ok: false, error: "You are not in a room" });
        return;
      }

      const roomId = roomByUserId.get(userId);
      if (roomId) {
        rematchAcceptedByRoomId.delete(roomId);
      }

      leaveRoom(io, socket, userId, `${username} left the room`);
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

    socket.on("invite:send", async (payload, callback) => {
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
      if (!roomId) {
        callback({ ok: false, error: "Create or join a room first" });
        return;
      }

      const room = rooms.get(roomId);
      if (!room || !room.players.has(userId)) {
        callback({ ok: false, error: "You are not in that room" });
        return;
      }

      const friend = await areFriends(userId, toUserId);
      if (!friend) {
        callback({ ok: false, error: "You can only invite users from your friend list" });
        return;
      }

      if (!isUserOnline(toUserId)) {
        callback({ ok: false, error: "Friend is offline" });
        return;
      }

      const inviteLink = `${socket.handshake.headers.origin || "http://localhost:3000"}/?room=${encodeURIComponent(roomId)}`;

      const friendSocketIds = socketsByUserId.get(toUserId);
      if (friendSocketIds) {
        for (const socketId of friendSocketIds) {
          io.to(socketId).emit("invite:received", {
            from: { userId, username },
            roomId,
            inviteLink,
          });
        }
      }

      callback({ ok: true, data: { roomId, inviteLink } });
    });

    socket.on("disconnect", () => {
      const sockets = socketsByUserId.get(userId);
      if (sockets) {
        sockets.delete(socket.id);
        if (sockets.size === 0) {
          socketsByUserId.delete(userId);
          onlineUsers.delete(userId);
          const currentRoomId = roomByUserId.get(userId);
          if (currentRoomId) {
            broadcastRoomState(io, currentRoomId);
          }
        } else {
          socketsByUserId.set(userId, sockets);
        }
      }

      broadcastOnlineUsers(io);
    });
  });
}
