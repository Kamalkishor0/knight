import type { Server } from "socket.io";
import type { JwtPayload } from "../types/auth.js";
type Ack<T = undefined> = {
    ok: true;
    data?: T;
} | {
    ok: false;
    error: string;
};
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
    by: {
        userId: string;
        username: string;
    };
};
type GameSnapshot = {
    roomId: string;
    fen: string;
    turn: "w" | "b";
    isCheck: boolean;
    status: "active" | "checkmate" | "stalemate" | "draw" | "insufficient_material" | "threefold_repetition";
    winnerColor?: "w" | "b";
    players: {
        white: {
            userId: string;
            username: string;
        };
        black: {
            userId: string;
            username: string;
        };
    };
};
type ClientToServerEvents = {
    "room:create": (payload: {
        roomId?: string;
    }, callback: (response: Ack<RoomState>) => void) => void;
    "room:join": (payload: {
        roomId: string;
    }, callback: (response: Ack<RoomState>) => void) => void;
    "room:leave": (callback: (response: Ack) => void) => void;
    "room:state": (callback: (response: Ack<RoomState>) => void) => void;
    "game:state": (callback: (response: Ack<GameSnapshot>) => void) => void;
    "chess:move": (payload: MovePayload, callback: (response: Ack<MoveResult>) => void) => void;
    "invite:send": (payload: {
        toUserId: string;
        roomId?: string;
    }, callback: (response: Ack<{
        inviteLink: string;
        roomId: string;
    }>) => void) => void;
};
type ServerToClientEvents = {
    "presence:online": (users: Array<{
        userId: string;
        username: string;
    }>) => void;
    "room:state": (room: RoomState) => void;
    "game:start": (payload: {
        roomId: string;
        white: {
            userId: string;
            username: string;
        };
        black: {
            userId: string;
            username: string;
        };
        fen: string;
        turn: "w" | "b";
    }) => void;
    "game:state": (snapshot: GameSnapshot) => void;
    "game:over": (snapshot: GameSnapshot) => void;
    "room:error": (payload: {
        message: string;
    }) => void;
    "chess:move": (payload: MoveResult) => void;
    "invite:received": (payload: {
        from: {
            userId: string;
            username: string;
        };
        roomId: string;
        inviteLink: string;
    }) => void;
};
type InterServerEvents = Record<string, never>;
type SocketData = {
    auth: JwtPayload;
};
type TypedServer = Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;
export declare function registerChessGateway(io: TypedServer): void;
export {};
