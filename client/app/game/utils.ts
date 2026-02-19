import type { GameSnapshot } from "@/types/socket";

export const INITIAL_CLOCK_MS = 3 * 60 * 1000;

export function parseUserIdFromToken(token: string): string | null {
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

export function formatClock(ms: number) {
	const clamped = Math.max(0, ms);
	const totalSeconds = Math.floor(clamped / 1000);
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function formatGameOverStatus(snapshot: GameSnapshot) {
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

export function pieceGlyph(piece?: { type: string; color: "w" | "b" }) {
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
