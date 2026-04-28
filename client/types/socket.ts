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
  status: "active" | "checkmate" | "stalemate" | "draw" | "insufficient_material" | "threefold_repetition" | "timeout";
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

export type InviteAcceptedEvent = {
  inviteId: string;
  roomId: string;
  acceptedBy: { userId: string; username: string };
};

export type MatchmakingStatusEvent = {
  status: "searching" | "matched" | "timeout" | "cancelled";
  message: string;
  expiresAt?: number;
};

export type MatchFoundEvent = {
  roomId: string;
  opponent: { userId: string; username: string };
};

export type ChatMessage = {
  id: string;
  roomId: string;
  text: string;
  createdAt: number;
  by: { userId: string; username: string };
};

export type ClientToServerEvents = {
  "room:create": (payload: { roomId?: string }, callback: (response: Ack<RoomState>) => void) => void;
  "room:join": (payload: { roomId: string }, callback: (response: Ack<RoomState>) => void) => void;
  "room:leave": (callback: (response: Ack) => void) => void;
  "matchmaking:join": (
    callback: (response: Ack<{ status: "searching"; expiresAt: number }>) => void,
  ) => void;
  "matchmaking:cancel": (callback: (response: Ack) => void) => void;
  "room:state": (callback: (response: Ack<RoomState>) => void) => void;
  "game:state": (callback: (response: Ack<GameSnapshot>) => void) => void;
  "chess:move": (payload: MovePayload, callback: (response: Ack<MoveResult>) => void) => void;
  "invite:send": (
    payload: { toUserId: string; roomId?: string },
    callback: (response: Ack<{ inviteId: string; inviteLink: string; roomId?: string }>) => void,
  ) => void;
  "invite:accept": (payload: { inviteId: string }, callback: (response: Ack<RoomState>) => void) => void;
  "game:rematch:request": (callback: (response: Ack<{ waitingFor?: string; started?: boolean }>) => void) => void;
	"game:rematch:respond": (payload: { accept: boolean }, callback: (response: Ack<{ started?: boolean }>) => void) => void;
  "game:draw:request": (callback: (response: Ack<{ waitingFor?: string; accepted?: boolean }>) => void) => void;
  "game:draw:respond": (payload: { accept: boolean }, callback: (response: Ack<{ accepted?: boolean }>) => void) => void;
  "chat:history": (callback: (response: Ack<{ messages: ChatMessage[] }>) => void) => void;
  "chat:send": (payload: { text: string; roomId?: string }, callback: (response: Ack<ChatMessage>) => void) => void;
};

export type ServerToClientEvents = {
  "presence:online": (users: Array<{ userId: string; username: string }>) => void;
  "room:state": (room: RoomState) => void;
  "matchmaking:status": (payload: MatchmakingStatusEvent) => void;
  "matchmaking:found": (payload: MatchFoundEvent) => void;
  "game:countdown": (payload: { roomId: string; secondsRemaining: number }) => void;
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
  "invite:received": (payload: {
    from: { userId: string; username: string };
    inviteId: string;
    roomId: string;
    inviteLink: string;
  }) => void;
  "invite:accepted": (payload: InviteAcceptedEvent) => void;
  "game:draw:requested": (payload: DrawRequestEvent) => void;
  "game:draw:status": (payload: DrawStatusEvent) => void;
  "chat:new": (message: ChatMessage) => void;
};
