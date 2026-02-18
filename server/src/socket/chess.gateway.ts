import { randomUUID } from "node:crypto";
import { Chess, type PieceSymbol } from "chess.js";
import type { Server, Socket } from "socket.io";
import prisma from "../db.js";
import type { JwtPayload } from "../types/auth.js";
import { verifyToken } from "../utils/jwt.js";

type Ack<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

type PlayerState = {
  userId: string;
  username: string;
  online: boolean;
  color?: "w" | "b";
};

type RoomState = {
  roomId: string;
  players: PlayerState[];
  status: "waiting" | "ready" | "playing";
};

type MovePayload = {
  roomId: string;
  from: string;
  to: string;
  promotion?: "q" | "r" | "b" | "n";
};

type MoveResult = {
  roomId: string;
  from: string;
  to: string;
  san: string;
  fen: string;
  turn: "w" | "b";
  by: { userId: string; username: string };
};

type GameSnapshot = {
  roomId: string;
  fen: string;
  turn: "w" | "b";
  isCheck: boolean;
  status: "active" | "checkmate" | "stalemate" | "draw" | "insufficient_material" | "threefold_repetition" | "timeout";
  winnerColor?: "w" | "b";
  clockMs: { w: number; b: number };
  players: {
    white: { userId: string; username: string };
    black: { userId: string; username: string };
  };
};

type ClientToServerEvents = {
  "room:create": (payload: { roomId?: string }, callback: (response: Ack<RoomState>) => void) => void;
  "room:join": (payload: { roomId: string }, callback: (response: Ack<RoomState>) => void) => void;
  "room:leave": (callback: (response: Ack) => void) => void;
  "room:state": (callback: (response: Ack<RoomState>) => void) => void;
  "game:state": (callback: (response: Ack<GameSnapshot>) => void) => void;
  "chess:move": (payload: MovePayload, callback: (response: Ack<MoveResult>) => void) => void;
  "invite:send": (
    payload: { toUserId: string; roomId?: string },
    callback: (response: Ack<{ inviteLink: string; roomId: string }>) => void,
  ) => void;
};

type ServerToClientEvents = {
  "presence:online": (users: Array<{ userId: string; username: string }>) => void;
  "room:state": (room: RoomState) => void;
  "game:start": (payload: {
    roomId: string;
    white: { userId: string; username: string };
    black: { userId: string; username: string };
    fen: string;
    turn: "w" | "b";
  }) => void;
  "game:state": (snapshot: GameSnapshot) => void;
  "game:over": (snapshot: GameSnapshot) => void;
  "room:error": (payload: { message: string }) => void;
  "chess:move": (payload: MoveResult) => void;
  "invite:received": (payload: {
    from: { userId: string; username: string };
    roomId: string;
    inviteLink: string;
  }) => void;
};

type InterServerEvents = Record<string, never>;

type SocketData = {
  auth: JwtPayload;
};

type TypedSocket = Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;
type TypedServer = Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

type Room = {
  id: string;
  players: Map<string, { userId: string; username: string }>;
  game?: {
    chess: Chess;
    whiteUserId: string;
    blackUserId: string;
    clockMs: { w: number; b: number };
    lastTickAt: number | null;
  };
};

const INITIAL_CLOCK_MS = 3 * 60 * 1000;
const rooms = new Map<string, Room>();
const roomByUserId = new Map<string, string>();
const socketsByUserId = new Map<string, Set<string>>();
const onlineUsers = new Map<string, { userId: string; username: string }>();

function applyActiveClock(game: NonNullable<Room["game"]>) {
  if (!game.lastTickAt) {
    return;
  }

  const now = Date.now();
  const elapsed = now - game.lastTickAt;
  if (elapsed <= 0) {
    return;
  }

  const activeTurn = game.chess.turn();
  game.clockMs[activeTurn] = Math.max(0, game.clockMs[activeTurn] - elapsed);
  game.lastTickAt = now;
}

function extractToken(socket: TypedSocket): string | null {
  const authToken = socket.handshake.auth.token;
  if (typeof authToken === "string" && authToken.trim()) {
    return authToken.trim();
  }

  const header = socket.handshake.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    return null;
  }

  const token = header.split(" ")[1];
  return token?.trim() || null;
}

function normalizeRoomId(roomId?: string): string {
  if (roomId && roomId.trim()) {
    return roomId.trim().toUpperCase();
  }

  return randomUUID().split("-")[0].toUpperCase();
}

function isUserOnline(userId: string): boolean {
  const sockets = socketsByUserId.get(userId);
  return Boolean(sockets && sockets.size > 0);
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

function getRoomState(room: Room): RoomState {
  const colorByUserId = room.game
    ? new Map<string, "w" | "b">([
        [room.game.whiteUserId, "w"],
        [room.game.blackUserId, "b"],
      ])
    : new Map<string, "w" | "b">();

  const players: PlayerState[] = Array.from(room.players.values()).map((player) => ({
    userId: player.userId,
    username: player.username,
    online: isUserOnline(player.userId),
    color: colorByUserId.get(player.userId),
  }));

  return {
    roomId: room.id,
    players,
    status: room.game ? "playing" : players.length === 2 ? "ready" : "waiting",
  };
}

function getGameSnapshot(room: Room): GameSnapshot | null {
  if (!room.game) {
    return null;
  }

  applyActiveClock(room.game);

  const white = room.players.get(room.game.whiteUserId);
  const black = room.players.get(room.game.blackUserId);

  if (!white || !black) {
    return null;
  }

  const chess = room.game.chess;
  let status: GameSnapshot["status"] = "active";
  let winnerColor: "w" | "b" | undefined;

  if (room.game.clockMs.w <= 0) {
    status = "timeout";
    winnerColor = "b";
  } else if (room.game.clockMs.b <= 0) {
    status = "timeout";
    winnerColor = "w";
  } else if (chess.isCheckmate()) {
    status = "checkmate";
    winnerColor = chess.turn() === "w" ? "b" : "w";
  } else if (chess.isStalemate()) {
    status = "stalemate";
  } else if (chess.isInsufficientMaterial()) {
    status = "insufficient_material";
  } else if (chess.isThreefoldRepetition()) {
    status = "threefold_repetition";
  } else if (chess.isDraw()) {
    status = "draw";
  }

  if (status !== "active") {
    room.game.lastTickAt = null;
  }

  return {
    roomId: room.id,
    fen: chess.fen(),
    turn: chess.turn(),
    isCheck: chess.isCheck(),
    status,
    winnerColor,
    clockMs: { ...room.game.clockMs },
    players: {
      white: { userId: white.userId, username: white.username },
      black: { userId: black.userId, username: black.username },
    },
  };
}

function broadcastOnlineUsers(io: TypedServer) {
  io.emit("presence:online", Array.from(onlineUsers.values()));
}

function broadcastRoomState(io: TypedServer, roomId: string) {
  const room = rooms.get(roomId);
  if (!room) {
    return;
  }

  io.to(roomId).emit("room:state", getRoomState(room));
}

function broadcastGameState(io: TypedServer, roomId: string) {
  const room = rooms.get(roomId);
  if (!room) {
    return;
  }

  const snapshot = getGameSnapshot(room);
  if (!snapshot) {
    return;
  }

  io.to(roomId).emit("game:state", snapshot);

  if (snapshot.status !== "active") {
    io.to(roomId).emit("game:over", snapshot);
  }
}

function maybeStartGame(io: TypedServer, roomId: string) {
  const room = rooms.get(roomId);
  if (!room || room.players.size !== 2 || room.game) {
    return;
  }

  const [white, black] = Array.from(room.players.values());
  room.game = {
    chess: new Chess(),
    whiteUserId: white.userId,
    blackUserId: black.userId,
    clockMs: { w: INITIAL_CLOCK_MS, b: INITIAL_CLOCK_MS },
    lastTickAt: Date.now(),
  };

  const snapshot = getGameSnapshot(room);
  if (!snapshot) {
    return;
  }

  io.to(roomId).emit("game:start", {
    roomId,
    white: snapshot.players.white,
    black: snapshot.players.black,
    fen: snapshot.fen,
    turn: snapshot.turn,
  });

  io.to(roomId).emit("game:state", snapshot);
  broadcastRoomState(io, roomId);
}

function leaveRoom(io: TypedServer, socket: TypedSocket, userId: string, reason?: string) {
  const roomId = roomByUserId.get(userId);
  if (!roomId) {
    return;
  }

  const room = rooms.get(roomId);
  if (!room) {
    roomByUserId.delete(userId);
    return;
  }

  room.players.delete(userId);
  roomByUserId.delete(userId);
  socket.leave(roomId);

  if (room.game && (room.game.whiteUserId === userId || room.game.blackUserId === userId)) {
    room.game = undefined;
  }

  if (room.players.size === 0) {
    rooms.delete(roomId);
    return;
  }

  if (reason) {
    io.to(roomId).emit("room:error", { message: reason });
  }

  broadcastRoomState(io, roomId);
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
