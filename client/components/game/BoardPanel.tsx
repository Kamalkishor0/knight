import { type Chess, type Square } from "chess.js";
import { formatClock, pieceGlyph } from "@/app/game/utils";
import type { GameSnapshot } from "@/types/socket";

type BoardPanelProps = {
	chess: Chess | null;
	myColor: "w" | "b" | null;
	gameState: GameSnapshot | null;
	isGameOver: boolean;
	rematchRequestFrom: string | null;
	isWaitingRematchResponse: boolean;
	drawRequestFrom: string | null;
	isWaitingDrawResponse: boolean;
	clockMs: { w: number; b: number };
	selectedSquare: string | null;
	legalTargets: string[];
	files: string[];
	ranks: number[];
	onSquareClick: (square: string) => void;
	onNewGame: () => void;
	onAcceptRematch: () => void;
	onDeclineRematch: () => void;
	onOfferDraw: () => void;
	onAcceptDraw: () => void;
	onDeclineDraw: () => void;
	onExit: () => void;
};

export function BoardPanel({
	chess,
	myColor,
	gameState,
	isGameOver,
	rematchRequestFrom,
	isWaitingRematchResponse,
	drawRequestFrom,
	isWaitingDrawResponse,
	clockMs,
	selectedSquare,
	legalTargets,
	files,
	ranks,
	onSquareClick,
	onNewGame,
	onAcceptRematch,
	onDeclineRematch,
	onOfferDraw,
	onAcceptDraw,
	onDeclineDraw,
	onExit,
}: BoardPanelProps) {
	const showIncomingRematch = Boolean(rematchRequestFrom);
	const showIncomingDraw = Boolean(drawRequestFrom);

	const gameOverSummary = (() => {
		if (!gameState || gameState.status === "active") {
			return null;
		}

		if (gameState.status === "checkmate") {
			return gameState.winnerColor
				? `${gameState.winnerColor === "w" ? "White" : "Black"} wins by checkmate`
				: "Checkmate";
		}

		if (gameState.status === "timeout") {
			return gameState.winnerColor
				? `${gameState.winnerColor === "w" ? "White" : "Black"} wins on time`
				: "Game ended on time";
		}

		if (
			gameState.status === "draw" ||
			gameState.status === "stalemate" ||
			gameState.status === "insufficient_material" ||
			gameState.status === "threefold_repetition"
		) {
			return "Draw";
		}

		return "Game over";
	})();

	return (
		<>
		<div className="rounded-2xl border border-slate-700 bg-slate-800 p-5 shadow-lg shadow-black/20">
			<h2 className="text-lg font-medium">Board</h2>
			<p className="mt-1 text-sm text-slate-300">You are: {myColor === "w" ? "White" : myColor === "b" ? "Black" : "Spectator"}</p>

			{!isGameOver && myColor ? (
				<div className="mt-3 flex flex-wrap items-center gap-2">
					{showIncomingDraw ? (
						<>
							<p className="w-full text-sm text-slate-300">{drawRequestFrom} offered a draw. Accept?</p>
							<button
								type="button"
								onClick={onAcceptDraw}
								className="rounded bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700"
							>
								Accept draw
							</button>
							<button
								type="button"
								onClick={onDeclineDraw}
								className="rounded bg-rose-600 px-3 py-2 text-sm font-medium text-white hover:bg-rose-700"
							>
								Decline
							</button>
						</>
					) : (
						<button
							type="button"
							onClick={onOfferDraw}
							disabled={isWaitingDrawResponse}
							className="rounded bg-amber-600 px-3 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-70"
						>
							{isWaitingDrawResponse ? "Draw offer sent" : "Offer draw"}
						</button>
					)}
				</div>
			) : null}

			<div className="mt-3 grid grid-cols-2 gap-2 text-sm">
				<div
					className={`rounded border px-3 py-2 ${
						gameState?.turn === "w" && gameState?.status === "active" ? "border-emerald-400 bg-emerald-900/30" : "border-slate-600"
					}`}
				>
					<div className="font-medium">White</div>
					<div className="font-mono text-lg">{formatClock(clockMs.w)}</div>
				</div>
				<div
					className={`rounded border px-3 py-2 ${
						gameState?.turn === "b" && gameState?.status === "active" ? "border-emerald-400 bg-emerald-900/30" : "border-slate-600"
					}`}
				>
					<div className="font-medium">Black</div>
					<div className="font-mono text-lg">{formatClock(clockMs.b)}</div>
				</div>
			</div>

			{chess ? (
				<div className="mt-4 grid max-w-xl grid-cols-8 overflow-hidden rounded-lg border border-slate-600">
					{ranks.flatMap((rank, rankIndex) =>
						files.map((file, fileIndex) => {
							const square = `${file}${rank}`;
							const isDark = (rankIndex + fileIndex) % 2 === 1;
							const isSelected = selectedSquare === square;
							const isLegalTarget = legalTargets.includes(square);
							const piece = chess.get(square as Square);
							const pieceTone =
								piece?.color === "w"
									? "text-white drop-shadow-[0_1px_1px_rgba(2,6,23,0.95)] [text-shadow:0_0_2px_rgba(2,6,23,0.85)]"
									: "text-slate-950 drop-shadow-[0_1px_1px_rgba(248,250,252,0.85)] [text-shadow:0_0_2px_rgba(248,250,252,0.75)]";

							return (
								<button
									key={square}
									type="button"
									onClick={() => onSquareClick(square)}
									className={`relative flex aspect-square items-center justify-center text-2xl ${
										isDark ? "bg-emerald-700/70" : "bg-emerald-200/80"
									} ${isSelected ? "ring-4 ring-yellow-400" : ""}`}
									title={square}
								>
									<span className={`select-none text-[2.05rem] leading-none ${pieceTone}`}>{pieceGlyph(piece)}</span>
									{isLegalTarget ? <span className="absolute h-3 w-3 rounded-full bg-yellow-400/80" /> : null}
								</button>
							);
						}),
					)}
				</div>
			) : (
				<p className="mt-3 text-sm text-slate-400">Board appears when game starts (2 players in room).</p>
			)}
		</div>

		{isGameOver && gameOverSummary ? (
			<div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4">
				<div className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-800 p-6 shadow-xl shadow-black/40">
					<h3 className="text-xl font-semibold">Game over</h3>
					<p className="mt-2 text-base text-slate-100">{gameOverSummary}</p>

					<div className="mt-4 flex flex-wrap gap-2">
						{showIncomingRematch ? (
							<>
								<p className="w-full text-sm text-slate-300">{rematchRequestFrom} wants a rematch. Start a new game?</p>
								<button
									type="button"
									onClick={onAcceptRematch}
									className="rounded bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700"
								>
									Accept rematch
								</button>
								<button
									type="button"
									onClick={onDeclineRematch}
									className="rounded bg-rose-600 px-3 py-2 text-sm font-medium text-white hover:bg-rose-700"
								>
									Decline
								</button>
							</>
						) : (
							<button
								type="button"
								onClick={onNewGame}
								disabled={isWaitingRematchResponse}
								className="rounded bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-70"
							>
								{isWaitingRematchResponse ? "Waiting for response..." : "Rematch"}
							</button>
						)}
						<button
							type="button"
							onClick={onExit}
							className="rounded bg-slate-700 px-3 py-2 text-sm font-medium text-white hover:bg-slate-600"
						>
							Exit
						</button>
					</div>
				</div>
			</div>
		) : null}
		</>
	);
}
