"use client";

import { Chess, type Square } from "chess.js";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { BoardPanel } from "@/components/game/BoardPanel";
import { GameHeader } from "@/components/game/GameHeader";
import { MovesPanel } from "@/components/game/MovesPanel";
import { RoomPanel } from "@/components/game/RoomPanel";
import { useStoredAuthToken } from "@/lib/auth";
import { connectSocket, disconnectSocket, getSocket } from "@/lib/socket";
import { SOCKET_BASE_URL } from "@/lib/runtime-config";
import type { Ack, GameSnapshot, MoveResult, RematchRequestEvent, RematchStatusEvent, RoomState, DrawRequestEvent, DrawStatusEvent} from "@/types/socket";
import type { MoveLogItem } from "./types";
import { formatGameOverStatus, INITIAL_CLOCK_MS, parseUserIdFromToken } from "./utils";

const SOCKET_URL = SOCKET_BASE_URL;

export default function GamePage() {
	const router = useRouter();
	const [requestedRoomId] = useState(() => {
		if (typeof window === "undefined") {
			return "";
		}

		return (new URLSearchParams(window.location.search).get("room") || "").trim().toUpperCase();
	});

	const token = useStoredAuthToken();
	const [connected, setConnected] = useState(false);
	const [roomIdInput, setRoomIdInput] = useState(requestedRoomId);
	const [currentRoom, setCurrentRoom] = useState<RoomState | null>(null);
	const [gameState, setGameState] = useState<GameSnapshot | null>(null);
	const [selectedSquare, setSelectedSquare] = useState<string | null>(null);
	const [legalTargets, setLegalTargets] = useState<string[]>([]);
	const [moves, setMoves] = useState<MoveLogItem[]>([]);
	const [status, setStatus] = useState("Connecting...");
	const [clockMs, setClockMs] = useState({ w: INITIAL_CLOCK_MS, b: INITIAL_CLOCK_MS });
	const [rematchRequestFrom, setRematchRequestFrom] = useState<string | null>(null);
	const [isWaitingRematchResponse, setIsWaitingRematchResponse] = useState(false);
	const [drawRequestFrom, setDrawRequestFrom] = useState<string | null>(null);
	const [isWaitingDrawResponse, setIsWaitingDrawResponse] = useState(false);

	const activeTurnRef = useRef<"w" | "b" | null>(null);
	const lastTickRef = useRef<number | null>(null);

	useEffect(() => {
		if (!token) {
			router.replace("/auth");
		}
	}, [router, token]);

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
	}, [gameState]);

	useEffect(() => {
		if (!gameState || gameState.status !== "active") {
			activeTurnRef.current = null;
			lastTickRef.current = null;
			return;
		}

		activeTurnRef.current = gameState.turn;
		lastTickRef.current = Date.now();
	}, [gameState]);

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
	}, [connected, currentRoom?.roomId, gameState]);

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
			setMoves([]);
			setSelectedSquare(null);
			setLegalTargets([]);
			setRematchRequestFrom(null);
			setIsWaitingRematchResponse(false);
			setDrawRequestFrom(null);
			setIsWaitingDrawResponse(false);
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
			setIsWaitingRematchResponse(false);
			setDrawRequestFrom(null);
			setIsWaitingDrawResponse(false);
			setStatus(formatGameOverStatus(snapshot));
		};

		const onRematchRequested = (payload: RematchRequestEvent) => {
			setRematchRequestFrom(payload.from.username);
			setIsWaitingRematchResponse(false);
			setStatus(`${payload.from.username} requested a rematch.`);
		};

		const onRematchStatus = (payload: RematchStatusEvent) => {
			setStatus(payload.message);

			if (payload.status === "declined") {
				setRematchRequestFrom(null);
				setIsWaitingRematchResponse(false);
			}

			if (payload.status === "started") {
				setRematchRequestFrom(null);
				setIsWaitingRematchResponse(false);
			}
		};

		const onDrawRequested = (payload: DrawRequestEvent) => {
			setDrawRequestFrom(payload.from.username);
			setIsWaitingDrawResponse(false);
			setStatus(`${payload.from.username} requested a draw.`);
		};

		const onDrawStatus = (payload: DrawStatusEvent) => {
			setStatus(payload.message);

			if (payload.status === "requested") {
				if (payload.by?.userId === myUserId) {
					setIsWaitingDrawResponse(true);
				}
				return;
			}

			if (payload.status === "declined") {
				setDrawRequestFrom(null);
				setIsWaitingDrawResponse(false);
			}

			if (payload.status === "accepted") {
				setDrawRequestFrom(null);
				setIsWaitingDrawResponse(false);
			}
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
		socket.on("game:rematch:requested", onRematchRequested);
		socket.on("game:rematch:status", onRematchStatus);
		socket.on("game:draw:requested", onDrawRequested);
		socket.on("game:draw:status", onDrawStatus);
		return () => {
			socket.off("connect", onConnect);
			socket.off("disconnect", onDisconnect);
			socket.off("room:state", onRoomState);
			socket.off("room:error", onRoomError);
			socket.off("game:start", onGameStart);
			socket.off("game:state", onGameState);
			socket.off("game:over", onGameOver);
			socket.off("chess:move", onMove);
			socket.off("game:rematch:requested", onRematchRequested);
			socket.off("game:rematch:status", onRematchStatus);
			socket.off("game:draw:requested", onDrawRequested);
			socket.off("game:draw:status", onDrawStatus);
			disconnectSocket();
		};
	}, [myUserId, requestedRoomId, token]);

	function resetRoomState() {
		setCurrentRoom(null);
		setGameState(null);
		setMoves([]);
		setSelectedSquare(null);
		setLegalTargets([]);
		setClockMs({ w: INITIAL_CLOCK_MS, b: INITIAL_CLOCK_MS });
		setRematchRequestFrom(null);
		setIsWaitingRematchResponse(false);
		setDrawRequestFrom(null);
		setIsWaitingDrawResponse(false);
		activeTurnRef.current = null;
		lastTickRef.current = null;
	}

	function createRoomAndNavigate() {
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

	function handleCreateRoom() {
		createRoomAndNavigate();
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

	function leaveCurrentRoom(onLeft?: () => void) {
		const socket = getSocket();
		if (!socket || !currentRoom?.roomId) {
			onLeft?.();
			return;
		}

		socket.emit("room:leave", (response: Ack) => {
			if (!response.ok) {
				setStatus(response.error);
				return;
			}

			resetRoomState();
			onLeft?.();
		});
	}

	function handleLeaveRoom() {
		leaveCurrentRoom(() => {
			setStatus("Left room");
			router.replace("/game");
		});
	}

	function handleNewGame() {
		const socket = getSocket();
		if (!socket) {
			setStatus("Socket not connected.");
			return;
		}

		socket.emit("game:rematch:request", (response) => {
			if (!response.ok) {
				setStatus(response.error);
				return;
			}

			setRematchRequestFrom(null);
			if (response.data?.started) {
				setIsWaitingRematchResponse(false);
				setStatus("Rematch accepted. Starting new game...");
				return;
			}

			setIsWaitingRematchResponse(true);
			setStatus(`Rematch request sent. Waiting for ${response.data?.waitingFor || "opponent"}.`);
		});
	}

	function handleAcceptRematch() {
		const socket = getSocket();
		if (!socket) {
			setStatus("Socket not connected.");
			return;
		}

		socket.emit("game:rematch:respond", { accept: true }, (response) => {
			if (!response.ok) {
				setStatus(response.error);
				return;
			}

			setRematchRequestFrom(null);
			if (response.data?.started) {
				setIsWaitingRematchResponse(false);
				setStatus("Rematch accepted. Starting new game...");
				return;
			}

			setIsWaitingRematchResponse(true);
			setStatus("Rematch accepted. Waiting for opponent...");
		});
	}

	function handleDeclineRematch() {
		const socket = getSocket();
		if (!socket) {
			setStatus("Socket not connected.");
			return;
		}

		socket.emit("game:rematch:respond", { accept: false }, (response) => {
			if (!response.ok) {
				setStatus(response.error);
				return;
			}

			setRematchRequestFrom(null);
			setIsWaitingRematchResponse(false);
			setStatus("You declined the rematch request.");
		});
	}

	function handleOfferDraw() {
		const socket = getSocket();
		if (!socket) {
			setStatus("Socket not connected.");
			return;
		}

		socket.emit("game:draw:request", (response) => {
			if (!response.ok) {
				setStatus(response.error);
				return;
			}

			setDrawRequestFrom(null);
			if (response.data?.accepted) {
				setIsWaitingDrawResponse(false);
				setStatus("Draw accepted. Game over.");
				return;
			}

			setIsWaitingDrawResponse(true);
			setStatus(`Draw offer sent. Waiting for ${response.data?.waitingFor || "opponent"}.`);
		});
	}
	
	function handleAcceptDraw() {
		const socket = getSocket();
		if (!socket) {
			setStatus("Socket not connected.");
			return;
		}

		socket.emit("game:draw:respond", { accept: true }, (response) => {
			if (!response.ok) {
				setStatus(response.error);
				return;
			}

			setDrawRequestFrom(null);
			if (response.data?.accepted) {
				setIsWaitingDrawResponse(false);
				setStatus("Draw accepted. Game over.");
				return;
			}

			setIsWaitingDrawResponse(false);
			setStatus("Draw accepted.");
		});
	}

	function handleDeclineDraw() {
		const socket = getSocket();
		if (!socket) {
			setStatus("Socket not connected.");
			return;
		}

		socket.emit("game:draw:respond", { accept: false }, (response) => {
			if (!response.ok) {
				setStatus(response.error);
				return;
			}

			setDrawRequestFrom(null);
			setIsWaitingDrawResponse(false);
			setStatus("You declined the draw request.");
		});
	}

	function handleExitAfterGame() {
		leaveCurrentRoom(() => {
			router.push("/home");
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

	const isGameOver = Boolean(gameState && gameState.status !== "active");
	const files = myColor === "b" ? ["h", "g", "f", "e", "d", "c", "b", "a"] : ["a", "b", "c", "d", "e", "f", "g", "h"];
	const ranks = myColor === "b" ? [1, 2, 3, 4, 5, 6, 7, 8] : [8, 7, 6, 5, 4, 3, 2, 1];

	return (
		<main className="min-h-screen bg-slate-900 px-6 py-10 text-slate-100">
			<div className="mx-auto grid w-full max-w-6xl gap-4">
				<GameHeader
					status={status}
					connected={connected}
					hasRoom={Boolean(currentRoom)}
					onBackToFriends={() => router.push("/home")}
					onLeaveRoom={handleLeaveRoom}
				/>

				<RoomPanel
					currentRoom={currentRoom}
					roomIdInput={roomIdInput}
					onRoomIdInputChange={setRoomIdInput}
					onJoinRoom={handleJoinRoom}
					onCreateRoom={handleCreateRoom}
				/>

				<section className="grid gap-4 md:grid-cols-[1fr_360px]">
					<BoardPanel
						chess={chess}
						myColor={myColor}
						gameState={gameState}
						isGameOver={isGameOver}
						rematchRequestFrom={rematchRequestFrom}
						isWaitingRematchResponse={isWaitingRematchResponse}
						drawRequestFrom={drawRequestFrom}
						isWaitingDrawResponse={isWaitingDrawResponse}
						clockMs={clockMs}
						selectedSquare={selectedSquare}
						legalTargets={legalTargets}
						files={files}
						ranks={ranks}
						onSquareClick={handleSquareClick}
						onNewGame={handleNewGame}
						onAcceptRematch={handleAcceptRematch}
						onDeclineRematch={handleDeclineRematch}
						onOfferDraw={handleOfferDraw}
						onAcceptDraw={handleAcceptDraw}
						onDeclineDraw={handleDeclineDraw}
						onExit={handleExitAfterGame}
					/>

					<MovesPanel moves={moves} />
				</section>
			</div>
		</main>
	);
}
