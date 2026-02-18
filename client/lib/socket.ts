import { io, type Socket } from "socket.io-client";
import type { ClientToServerEvents, ServerToClientEvents } from "@/types/socket";

let socket: Socket<ServerToClientEvents, ClientToServerEvents> | null = null;

export function connectSocket({ token, url }: { token: string; url?: string }) {
  const socketUrl = url || process.env.NEXT_PUBLIC_SOCKET_URL || "http://localhost:3001";

  if (socket) {
    socket.disconnect();
  }

  socket = io(socketUrl, {
    autoConnect: true,
    transports: ["websocket"],
    auth: { token },
  });

  return socket;
}

export function getSocket() {
  return socket;
}

export function disconnectSocket() {
  if (!socket) {
    return;
  }

  socket.disconnect();
  socket = null;
}
