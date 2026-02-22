import { Chess } from "chess.js";
import type { Server, Socket } from "socket.io";
import type { JwtPayload } from "../types/auth.js";

export type Ack<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

export type PlayerState = {
  userId: string;
  username: string;
  online: boolean;
  color?: "w" | "b";
};

export type RoomState = {
  roomId: string;
  players: PlayerState[];
  status: "waiting" | "ready" | "playing";
};

export type MovePayload = {
  roomId: string;
  from: string;
  to: string;
  promotion?: "q" | "r" | "b" | "n";
};

export type MoveResult = {
  roomId: string;
  from: string;
  to: string;
  san: string;
  fen: string;
  turn: "w" | "b";
  by: { userId: string; username: string };
};

export type GameSnapshot = {
  roomId: string;
  fen: string;
  turn: "w" | "b";
  isCheck: boolean;
  status:
    | "active"
    | "checkmate"
    | "stalemate"
    | "draw"
    | "insufficient_material"
    | "threefold_repetition"
    | "timeout";
  winnerColor?: "w" | "b";
  clockMs: { w: number; b: number };
  players: {
    white: { userId: string; username: string };
    black: { userId: string; username: string };
  };
};

export type RematchRequestEvent = {
  from: { userId: string; username: string };
};

export type RematchStatusEvent = {
  status: "requested" | "declined" | "started";
  message: string;
  by?: { userId: string; username: string };
};

export type DrawRequestEvent = {
  from: { userId: string; username: string };
};

export type DrawStatusEvent = {
  status: "requested" | "declined" | "accepted";
  message: string;
  by?: { userId: string; username: string };
};

export type ClientToServerEvents = {
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
  "game:rematch:request": (callback: (response: Ack<{ waitingFor?: string; started?: boolean }>) => void) => void;
  "game:rematch:respond": (payload: { accept: boolean }, callback: (response: Ack<{ started?: boolean }>) => void) => void;
  "game:draw:request": (callback: (response: Ack<{ waitingFor?: string; accepted?: boolean }>) => void) => void;
  "game:draw:respond": (payload: { accept: boolean }, callback: (response: Ack<{ accepted?: boolean }>) => void) => void;
};

export type ServerToClientEvents = {
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
  "game:rematch:requested": (payload: RematchRequestEvent) => void;
  "game:rematch:status": (payload: RematchStatusEvent) => void;
  "game:draw:requested": (payload: DrawRequestEvent) => void;
  "game:draw:status": (payload: DrawStatusEvent) => void;
  "invite:received": (payload: {
    from: { userId: string; username: string };
    roomId: string;
    inviteLink: string;
  }) => void;
};

export type InterServerEvents = Record<string, never>;

export type SocketData = {
  auth: JwtPayload;
};

export type TypedSocket = Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;
export type TypedServer = Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

export type Room = {
  id: string;
  players: Map<string, { userId: string; username: string }>;
  game?: {
    chess: Chess;
    whiteUserId: string;
    blackUserId: string;
    clockMs: { w: number; b: number };
    lastTickAt: number | null;
    agreedDraw: boolean;
  };
};
