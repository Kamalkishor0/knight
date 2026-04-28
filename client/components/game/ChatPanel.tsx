import { useEffect, useRef } from "react";
import type { ChatMessage } from "@/types/socket";

type ChatPanelProps = {
  messages: ChatMessage[];
  value: string;
  connected: boolean;
  hasRoom: boolean;
  currentUserId?: string | null;
  onChange: (value: string) => void;
  onSend: () => void;
};

function formatMessageTime(createdAt: number): string {
  return new Date(createdAt).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function ChatPanel({ messages, value, connected, hasRoom, currentUserId, onChange, onSend }: ChatPanelProps) {
  const disabled = !connected || !hasRoom;
  const listRef = useRef<HTMLUListElement | null>(null);

  useEffect(() => {
    const list = listRef.current;
    if (!list) {
      return;
    }

    list.scrollTop = list.scrollHeight;
  }, [messages]);

  return (
    <div className="flex h-full min-h-0 flex-col rounded-2xl border border-slate-700 bg-slate-800 p-5 shadow-lg shadow-black/20">
      <h2 className="text-lg font-medium">Chat</h2>

      <ul ref={listRef} className="mt-3 flex-1 space-y-2 overflow-auto text-sm">
        {messages.length === 0 ? <li className="text-slate-400">No messages yet.</li> : null}
        {messages.map((message) => (
          <li
            key={message.id}
            className={`flex ${message.by.userId === currentUserId ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[85%] rounded-2xl px-3 py-2 ${
                message.by.userId === currentUserId
                  ? "bg-sky-500/90 text-slate-950"
                  : "bg-slate-700 text-slate-100"
              }`}
            >
              <div
                className={`flex items-center justify-between gap-3 text-xs ${
                  message.by.userId === currentUserId ? "text-slate-900/80" : "text-slate-300"
                }`}
              >
                <span className="font-medium">{message.by.username}</span>
                <span>{formatMessageTime(message.createdAt)}</span>
              </div>
              <p className="mt-1 whitespace-pre-wrap wrap-break-word">{message.text}</p>
            </div>
          </li>
        ))}
      </ul>

      <div className="mt-3 flex gap-2">
        <input
          type="text"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              onSend();
            }
          }}
          placeholder={disabled ? "Join a room to chat" : "Type a message..."}
          maxLength={300}
          disabled={disabled}
          className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none ring-sky-500 transition focus:ring-2 disabled:cursor-not-allowed disabled:opacity-60"
        />
        <button
          type="button"
          onClick={onSend}
          disabled={disabled || !value.trim()}
          className="rounded-lg bg-sky-500 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Send
        </button>
      </div>
    </div>
  );
}
