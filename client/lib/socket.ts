import { io, type Socket } from "socket.io-client";
import { SOCKET_BASE_URL } from "@/lib/runtime-config";
import type { ClientToServerEvents, ServerToClientEvents } from "@/types/socket";

let socket: Socket<ServerToClientEvents, ClientToServerEvents> | null = null;

export function connectSocket({ token, url }: { token: string; url?: string }) {
  const socketUrl = (url || SOCKET_BASE_URL).trim().replace(/\/+$/, "");

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
