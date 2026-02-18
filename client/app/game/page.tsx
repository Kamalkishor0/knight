"use client";

import { Chess, type Square } from "chess.js";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { connectSocket, disconnectSocket, getSocket } from "@/lib/socket";
import type { Ack, GameSnapshot, MoveResult, RoomState } from "@/types/socket";

const STORAGE_KEY = "knight-auth-token";
const SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL || process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";
const INITIAL_CLOCK_MS = 3 * 60 * 1000;

type MoveLogItem = {
	from: string;
	to: string;
	san: string;
	byLabel: string;
	at: string;
};

function parseUserIdFromToken(token: string): string | null {
	try {
		const payload = token.split(".")[1];
		if (!payload) {
			return null;
		}

		const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
		const decoded = JSON.parse(atob(base64)) as { userId?: string };
		return typeof decoded.userId === "string" ? decoded.userId : null;
	} catch {
		return null;
	}
}

function formatClock(ms: number) {
	const clamped = Math.max(0, ms);
	const totalSeconds = Math.floor(clamped / 1000);
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function formatGameOverStatus(snapshot: GameSnapshot) {
	if (snapshot.status === "timeout") {
		if (!snapshot.winnerColor) {
			return "Game over: timeout";
		}

		return `Game over on time: ${snapshot.winnerColor === "w" ? "White" : "Black"} wins`;
	}

	if (snapshot.status === "checkmate") {
		if (!snapshot.winnerColor) {
			return "Game over: checkmate";
		}

		return `Game over: checkmate. ${snapshot.winnerColor === "w" ? "White" : "Black"} wins`;
	}

	return `Game over: ${snapshot.status}`;
}

function pieceGlyph(piece?: { type: string; color: "w" | "b" }) {
	if (!piece) {
		return "";
	}

	const code = `${piece.color}${piece.type}`;
	return code === "wp"
		? "♙"
		: code === "wr"
			? "♖"
			: code === "wn"
				? "♘"
				: code === "wb"
					? "♗"
					: code === "wq"
						? "♕"
						: code === "wk"
							? "♔"
							: code === "bp"
								? "♟"
								: code === "br"
									? "♜"
									: code === "bn"
										? "♞"
										: code === "bb"
											? "♝"
											: code === "bq"
												? "♛"
												: "♚";
}

export default function GamePage() {
	const router = useRouter();
	const searchParams = useSearchParams();
	const requestedRoomId = (searchParams.get("room") || "").trim().toUpperCase();

	const [token, setToken] = useState("");
	const [connected, setConnected] = useState(false);
	const [roomIdInput, setRoomIdInput] = useState(requestedRoomId);
	const [currentRoom, setCurrentRoom] = useState<RoomState | null>(null);
	const [gameState, setGameState] = useState<GameSnapshot | null>(null);
	const [selectedSquare, setSelectedSquare] = useState<string | null>(null);
	const [legalTargets, setLegalTargets] = useState<string[]>([]);
	const [moves, setMoves] = useState<MoveLogItem[]>([]);
	const [status, setStatus] = useState("Connecting...");
	const [clockMs, setClockMs] = useState({ w: INITIAL_CLOCK_MS, b: INITIAL_CLOCK_MS });

	const activeTurnRef = useRef<"w" | "b" | null>(null);
	const lastTickRef = useRef<number | null>(null);

	useEffect(() => {
		const saved = window.localStorage.getItem(STORAGE_KEY);
		if (!saved) {
			router.replace("/");
			return;
		}

		setToken(saved);
	}, [router]);

	const myUserId = useMemo(() => (token ? parseUserIdFromToken(token) : null), [token]);

	const myColor = useMemo(() => {
		if (!gameState || !myUserId) {
			return null;
		}

		if (gameState.players.white.userId === myUserId) {
			return "w";
		}

		if (gameState.players.black.userId === myUserId) {
			return "b";
		}

		return null;
	}, [gameState, myUserId]);

	const chess = useMemo(() => {
		if (!gameState?.fen) {
			return null;
		}

		return new Chess(gameState.fen);
	}, [gameState?.fen]);

	useEffect(() => {
		if (!gameState || gameState.status !== "active") {
			activeTurnRef.current = null;
			lastTickRef.current = null;
			return;
		}

		activeTurnRef.current = gameState.turn;
		lastTickRef.current = Date.now();
	}, [gameState?.turn, gameState?.status]);

	useEffect(() => {
		const timer = window.setInterval(() => {
			if (!gameState || gameState.status !== "active") {
				return;
			}

			const activeTurn = activeTurnRef.current;
			const lastTick = lastTickRef.current;
			if (!activeTurn || !lastTick) {
				return;
			}

			const now = Date.now();
			const elapsed = now - lastTick;
			lastTickRef.current = now;

			setClockMs((prev) => ({
				...prev,
				[activeTurn]: Math.max(0, prev[activeTurn] - elapsed),
			}));
		}, 250);

		return () => window.clearInterval(timer);
	}, [gameState]);

	useEffect(() => {
		if (!connected || !currentRoom?.roomId || !gameState || gameState.status !== "active") {
			return;
		}

		const socket = getSocket();
		if (!socket) {
			return;
		}

		const poller = window.setInterval(() => {
			socket.emit("game:state", (response: Ack<GameSnapshot>) => {
				if (response.ok && response.data) {
					setGameState(response.data);
					setClockMs(response.data.clockMs);
				}
			});
		}, 1000);

		return () => window.clearInterval(poller);
	}, [connected, currentRoom?.roomId, gameState?.status]);

	useEffect(() => {
		if (!token) {
			return;
		}

		const socket = connectSocket({ token, url: SOCKET_URL });

		const onConnect = () => {
			setConnected(true);
			setStatus("Connected");

			if (requestedRoomId) {
				socket.emit("room:join", { roomId: requestedRoomId }, (response: Ack<RoomState>) => {
					if (!response.ok || !response.data) {
						setStatus(response.ok ? "Failed to join room." : response.error);
						return;
					}

					setCurrentRoom(response.data);
					setStatus(`Joined room ${response.data.roomId}`);
				});
			} else {
				socket.emit("room:state", (response: Ack<RoomState>) => {
					if (response.ok && response.data) {
						setCurrentRoom(response.data);
					}
				});
			}

			socket.emit("game:state", (response: Ack<GameSnapshot>) => {
				if (response.ok && response.data) {
					setGameState(response.data);
					setClockMs(response.data.clockMs);
					if (response.data.status === "active") {
						setStatus(`Turn: ${response.data.turn === "w" ? "White" : "Black"}${response.data.isCheck ? " (check)" : ""}`);
					} else {
						setStatus(formatGameOverStatus(response.data));
					}
				}
			});
		};

		const onDisconnect = () => {
			setConnected(false);
			setStatus("Disconnected");
		};

		const onRoomState = (room: RoomState) => {
			setCurrentRoom(room);
			setStatus(`Room ${room.roomId}: ${room.status}`);
		};

		const onRoomError = (payload: { message: string }) => {
			setStatus(payload.message);
		};

		const onGameStart = (payload: {
			roomId: string;
			white: { userId: string; username: string };
			black: { userId: string; username: string };
			fen: string;
			turn: "w" | "b";
		}) => {
			setClockMs({ w: INITIAL_CLOCK_MS, b: INITIAL_CLOCK_MS });
			activeTurnRef.current = payload.turn;
			lastTickRef.current = Date.now();
			setStatus(`Game started: ${payload.white.username} vs ${payload.black.username}`);
		};

		const onGameState = (snapshot: GameSnapshot) => {
			setGameState(snapshot);
			setClockMs(snapshot.clockMs);
			if (snapshot.status === "active") {
				setStatus(`Turn: ${snapshot.turn === "w" ? "White" : "Black"}${snapshot.isCheck ? " (check)" : ""}`);
				return;
			}

			setStatus(formatGameOverStatus(snapshot));
		};

		const onGameOver = (snapshot: GameSnapshot) => {
			setGameState(snapshot);
			setClockMs(snapshot.clockMs);
			activeTurnRef.current = null;
			lastTickRef.current = null;
			setStatus(formatGameOverStatus(snapshot));
		};

		const onMove = (payload: MoveResult) => {
			setMoves((prev) => [
				...prev,
				{
					from: payload.from,
					to: payload.to,
					san: payload.san,
					byLabel: payload.by.username,
					at: new Date().toLocaleTimeString(),
				},
			]);
			setSelectedSquare(null);
			setLegalTargets([]);
		};

		socket.on("connect", onConnect);
		socket.on("disconnect", onDisconnect);
		socket.on("room:state", onRoomState);
		socket.on("room:error", onRoomError);
		socket.on("game:start", onGameStart);
		socket.on("game:state", onGameState);
		socket.on("game:over", onGameOver);
		socket.on("chess:move", onMove);

		return () => {
			socket.off("connect", onConnect);
			socket.off("disconnect", onDisconnect);
			socket.off("room:state", onRoomState);
			socket.off("room:error", onRoomError);
			socket.off("game:start", onGameStart);
			socket.off("game:state", onGameState);
			socket.off("game:over", onGameOver);
			socket.off("chess:move", onMove);
			disconnectSocket();
		};
	}, [requestedRoomId, token]);

	function handleCreateRoom() {
		const socket = getSocket();
		if (!socket) {
			setStatus("Socket not connected.");
			return;
		}

		socket.emit("room:create", {}, (response: Ack<RoomState>) => {
			if (!response.ok || !response.data) {
				setStatus(response.ok ? "Failed to create room." : response.error);
				return;
			}

			setCurrentRoom(response.data);
			setRoomIdInput(response.data.roomId);
			setStatus(`Created room ${response.data.roomId}`);
			router.replace(`/game?room=${encodeURIComponent(response.data.roomId)}`);
		});
	}

	function handleJoinRoom() {
		const socket = getSocket();
		if (!socket) {
			setStatus("Socket not connected.");
			return;
		}

		if (!roomIdInput.trim()) {
			setStatus("Enter a room ID.");
			return;
		}

		socket.emit("room:join", { roomId: roomIdInput.trim().toUpperCase() }, (response: Ack<RoomState>) => {
			if (!response.ok || !response.data) {
				setStatus(response.ok ? "Failed to join room." : response.error);
				return;
			}

			setCurrentRoom(response.data);
			setStatus(`Joined room ${response.data.roomId}`);
			router.replace(`/game?room=${encodeURIComponent(response.data.roomId)}`);
		});
	}

	function handleLeaveRoom() {
		const socket = getSocket();
		if (!socket) {
			return;
		}

		socket.emit("room:leave", (response: Ack) => {
			if (!response.ok) {
				setStatus(response.error);
				return;
			}

			setCurrentRoom(null);
			setGameState(null);
			setMoves([]);
			setSelectedSquare(null);
			setLegalTargets([]);
			setClockMs({ w: INITIAL_CLOCK_MS, b: INITIAL_CLOCK_MS });
			activeTurnRef.current = null;
			lastTickRef.current = null;
			setStatus("Left room");
			router.replace("/game");
		});
	}

	function handleSquareClick(square: string) {
		if (!chess || !gameState || gameState.status !== "active") {
			setStatus("Game is not active.");
			return;
		}

		if (!myColor) {
			setStatus("You are spectating this game.");
			return;
		}

		if (gameState.turn !== myColor) {
			setStatus("Not your turn.");
			return;
		}

		const squareKey = square as Square;
		const clickedPiece = chess.get(squareKey);

		if (!selectedSquare) {
			if (!clickedPiece || clickedPiece.color !== myColor) {
				return;
			}

			const targets = (chess.moves({ square: squareKey, verbose: true }) as Array<{ to: string }>).map((move) => move.to);
			setSelectedSquare(square);
			setLegalTargets(targets);
			return;
		}

		if (selectedSquare === square) {
			setSelectedSquare(null);
			setLegalTargets([]);
			return;
		}

		if (clickedPiece && clickedPiece.color === myColor) {
			const targets = (chess.moves({ square: squareKey, verbose: true }) as Array<{ to: string }>).map((move) => move.to);
			setSelectedSquare(square);
			setLegalTargets(targets);
			return;
		}

		if (!legalTargets.includes(square)) {
			return;
		}

		const socket = getSocket();
		if (!socket || !currentRoom?.roomId) {
			setStatus("Join a room first.");
			return;
		}

		const fromPiece = chess.get(selectedSquare as Square);
		const promotion = fromPiece?.type === "p" && (square.endsWith("8") || square.endsWith("1")) ? "q" : undefined;

		socket.emit(
			"chess:move",
			{ roomId: currentRoom.roomId, from: selectedSquare, to: square, promotion },
			(response: Ack<MoveResult>) => {
				if (!response.ok) {
					setStatus(response.error);
				}
			},
		);
	}

	if (!token) {
		return null;
	}

	const files = myColor === "b" ? ["h", "g", "f", "e", "d", "c", "b", "a"] : ["a", "b", "c", "d", "e", "f", "g", "h"];
	const ranks = myColor === "b" ? [1, 2, 3, 4, 5, 6, 7, 8] : [8, 7, 6, 5, 4, 3, 2, 1];

	return (
		<main className="min-h-screen bg-slate-50 px-6 py-10 text-slate-900">
			<div className="mx-auto grid w-full max-w-6xl gap-4">
				<header className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
					<div className="flex flex-wrap items-center justify-between gap-3">
						<div>
							<h1 className="text-2xl font-semibold">Chess Game</h1>
							<p className="text-sm text-slate-600">Status: {status}</p>
							<p className="text-sm text-slate-600">Connection: {connected ? "Connected" : "Disconnected"}</p>
						</div>
						<div className="flex gap-2">
							<button
								type="button"
								onClick={() => router.push("/friends")}
								className="rounded bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700"
							>
								Back to friends
							</button>
							{currentRoom ? (
								<button
									type="button"
									onClick={handleLeaveRoom}
									className="rounded bg-rose-600 px-3 py-2 text-sm font-medium text-white hover:bg-rose-700"
								>
									Leave room
								</button>
							) : null}
						</div>
					</div>
				</header>

				<section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
					<h2 className="text-lg font-medium">Room</h2>
					<p className="mt-1 text-sm text-slate-600">Current: {currentRoom ? `${currentRoom.roomId} (${currentRoom.status})` : "No room"}</p>
					<div className="mt-3 flex flex-wrap gap-2">
						<input
							type="text"
							placeholder="Room ID"
							value={roomIdInput}
							onChange={(event) => setRoomIdInput(event.target.value.toUpperCase())}
							className="rounded-md border border-slate-300 px-3 py-2"
						/>
						<button
							type="button"
							onClick={handleJoinRoom}
							className="rounded bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700"
						>
							Join room
						</button>
						<button
							type="button"
							onClick={handleCreateRoom}
							className="rounded bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700"
						>
							Create room
						</button>
					</div>
				</section>

				<section className="grid gap-4 md:grid-cols-[1fr_360px]">
					<div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
						<h2 className="text-lg font-medium">Board</h2>
						<p className="mt-1 text-sm text-slate-600">
							You are: {myColor === "w" ? "White" : myColor === "b" ? "Black" : "Spectator"}
						</p>
						{gameState?.winnerColor ? (
							<p className="mt-1 text-sm font-medium text-rose-600">
								Winner: {gameState.winnerColor === "w" ? "White" : "Black"}
								{gameState.status === "checkmate" ? " (checkmate)" : gameState.status === "timeout" ? " (time out)" : ""}
							</p>
						) : null}

						<div className="mt-3 grid grid-cols-2 gap-2 text-sm">
							<div className={`rounded border px-3 py-2 ${gameState?.turn === "w" && gameState?.status === "active" ? "border-emerald-400 bg-emerald-50" : "border-slate-200"}`}>
								<div className="font-medium">White</div>
								<div className="font-mono text-lg">{formatClock(clockMs.w)}</div>
							</div>
							<div className={`rounded border px-3 py-2 ${gameState?.turn === "b" && gameState?.status === "active" ? "border-emerald-400 bg-emerald-50" : "border-slate-200"}`}>
								<div className="font-medium">Black</div>
								<div className="font-mono text-lg">{formatClock(clockMs.b)}</div>
							</div>
						</div>

						{chess ? (
							<div className="mt-4 grid max-w-xl grid-cols-8 overflow-hidden rounded-lg border border-slate-300">
								{ranks.flatMap((rank, rankIndex) =>
									files.map((file, fileIndex) => {
										const square = `${file}${rank}`;
										const isDark = (rankIndex + fileIndex) % 2 === 1;
										const isSelected = selectedSquare === square;
										const isLegalTarget = legalTargets.includes(square);
										const piece = chess.get(square as Square);
										const pieceTone = piece?.color === "w" ? "text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.9)]" : "text-slate-950 drop-shadow-[0_1px_1px_rgba(255,255,255,0.7)]";

										return (
											<button
												key={square}
												type="button"
												onClick={() => handleSquareClick(square)}
												className={`relative flex aspect-square items-center justify-center text-2xl ${
													isDark ? "bg-emerald-700/70" : "bg-emerald-200/80"
												} ${isSelected ? "ring-4 ring-yellow-400" : ""}`}
												title={square}
											>
												<span className={pieceTone}>{pieceGlyph(piece)}</span>
												{isLegalTarget ? <span className="absolute h-3 w-3 rounded-full bg-yellow-400/80" /> : null}
											</button>
										);
									}),
								)}
							</div>
						) : (
							<p className="mt-3 text-sm text-slate-500">Board appears when game starts (2 players in room).</p>
						)}
					</div>

					<div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
						<h2 className="text-lg font-medium">Moves</h2>
						<ul className="mt-3 max-h-125 space-y-2 overflow-auto text-sm">
							{moves.length === 0 ? <li className="text-slate-500">No moves yet.</li> : null}
							{moves.map((move, index) => (
								<li key={`${move.at}-${index}`} className="rounded border border-slate-200 p-2">
									#{index + 1} <b>{move.byLabel}</b>: {move.san} ({move.from}→{move.to})
								</li>
							))}
						</ul>
					</div>
				</section>
			</div>
		</main>
	);
}
