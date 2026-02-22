import { randomInt, randomUUID } from "node:crypto";
import { Chess } from "chess.js";
import type { GameSnapshot, Room, RoomState, TypedServer, TypedSocket } from "./chess.types.js";

export const INITIAL_CLOCK_MS = 3 * 60 * 1000;

export const rooms = new Map<string, Room>();
export const roomByUserId = new Map<string, string>();
export const socketsByUserId = new Map<string, Set<string>>();
export const onlineUsers = new Map<string, { userId: string; username: string }>();

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

export function extractToken(socket: TypedSocket): string | null {
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

export function normalizeRoomId(roomId?: string): string {
  if (roomId && roomId.trim()) {
    return roomId.trim().toUpperCase();
  }

  return randomUUID().split("-")[0].toUpperCase();
}

export function isUserOnline(userId: string): boolean {
  const sockets = socketsByUserId.get(userId);
  return Boolean(sockets && sockets.size > 0);
}

export function getRoomState(room: Room): RoomState {
  const colorByUserId = room.game
    ? new Map<string, "w" | "b">([
        [room.game.whiteUserId, "w"],
        [room.game.blackUserId, "b"],
      ])
    : new Map<string, "w" | "b">();

  const players = Array.from(room.players.values()).map((player) => ({
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

export function getGameSnapshot(room: Room): GameSnapshot | null {
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
  } else if (room.game.agreedDraw) {
    status = "draw";
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

export function broadcastOnlineUsers(io: TypedServer) {
  io.emit("presence:online", Array.from(onlineUsers.values()));
}

export function broadcastRoomState(io: TypedServer, roomId: string) {
  const room = rooms.get(roomId);
  if (!room) {
    return;
  }

  io.to(roomId).emit("room:state", getRoomState(room));
}

export function broadcastGameState(io: TypedServer, roomId: string) {
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

export function maybeStartGame(io: TypedServer, roomId: string) {
  const room = rooms.get(roomId);
  if (!room || room.players.size !== 2 || room.game) {
    return;
  }

  const players = Array.from(room.players.values());
  const whiteIndex = randomInt(0, players.length);
  const white = players[whiteIndex];
  const black = players[whiteIndex === 0 ? 1 : 0];

  if (!white || !black) {
    return;
  }

  room.game = {
    chess: new Chess(),
    whiteUserId: white.userId,
    blackUserId: black.userId,
    clockMs: { w: INITIAL_CLOCK_MS, b: INITIAL_CLOCK_MS },
    lastTickAt: Date.now(),
    agreedDraw: false,
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

export function leaveRoom(io: TypedServer, socket: TypedSocket, userId: string, reason?: string) {
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
