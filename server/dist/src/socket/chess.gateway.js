import { randomUUID } from "node:crypto";
import { Chess } from "chess.js";
import prisma from "../db.js";
import { verifyToken } from "../utils/jwt.js";
const rooms = new Map();
const roomByUserId = new Map();
const socketsByUserId = new Map();
const onlineUsers = new Map();
function extractToken(socket) {
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
function normalizeRoomId(roomId) {
    if (roomId && roomId.trim()) {
        return roomId.trim().toUpperCase();
    }
    return randomUUID().split("-")[0].toUpperCase();
}
function isUserOnline(userId) {
    const sockets = socketsByUserId.get(userId);
    return Boolean(sockets && sockets.size > 0);
}
async function areFriends(userIdA, userIdB) {
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
function getRoomState(room) {
    const colorByUserId = room.game
        ? new Map([
            [room.game.whiteUserId, "w"],
            [room.game.blackUserId, "b"],
        ])
        : new Map();
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
function getGameSnapshot(room) {
    if (!room.game) {
        return null;
    }
    const white = room.players.get(room.game.whiteUserId);
    const black = room.players.get(room.game.blackUserId);
    if (!white || !black) {
        return null;
    }
    const chess = room.game.chess;
    let status = "active";
    let winnerColor;
    if (chess.isCheckmate()) {
        status = "checkmate";
        winnerColor = chess.turn() === "w" ? "b" : "w";
    }
    else if (chess.isStalemate()) {
        status = "stalemate";
    }
    else if (chess.isInsufficientMaterial()) {
        status = "insufficient_material";
    }
    else if (chess.isThreefoldRepetition()) {
        status = "threefold_repetition";
    }
    else if (chess.isDraw()) {
        status = "draw";
    }
    return {
        roomId: room.id,
        fen: chess.fen(),
        turn: chess.turn(),
        isCheck: chess.isCheck(),
        status,
        winnerColor,
        players: {
            white: { userId: white.userId, username: white.username },
            black: { userId: black.userId, username: black.username },
        },
    };
}
function broadcastOnlineUsers(io) {
    io.emit("presence:online", Array.from(onlineUsers.values()));
}
function broadcastRoomState(io, roomId) {
    const room = rooms.get(roomId);
    if (!room) {
        return;
    }
    io.to(roomId).emit("room:state", getRoomState(room));
}
function broadcastGameState(io, roomId) {
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
function maybeStartGame(io, roomId) {
    const room = rooms.get(roomId);
    if (!room || room.players.size !== 2 || room.game) {
        return;
    }
    const [white, black] = Array.from(room.players.values());
    room.game = {
        chess: new Chess(),
        whiteUserId: white.userId,
        blackUserId: black.userId,
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
function leaveRoom(io, socket, userId, reason) {
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
export function registerChessGateway(io) {
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
        const userSockets = socketsByUserId.get(userId) ?? new Set();
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
            const room = {
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
            const playerColor = room.game.whiteUserId === userId ? "w" : room.game.blackUserId === userId ? "b" : null;
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
            const promotion = payload.promotion;
            let moveResult;
            try {
                moveResult = room.game.chess.move({
                    from,
                    to,
                    promotion,
                });
            }
            catch {
                callback({ ok: false, error: "Illegal move" });
                return;
            }
            if (!moveResult) {
                callback({ ok: false, error: "Illegal move" });
                return;
            }
            const eventPayload = {
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
                }
                else {
                    socketsByUserId.set(userId, sockets);
                }
            }
            broadcastOnlineUsers(io);
        });
    });
}
//# sourceMappingURL=chess.gateway.js.map