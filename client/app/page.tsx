"use client";

import Link from "next/link";

const files = ["a", "b", "c", "d", "e", "f", "g", "h"];
const randomPieces = [
	{ piece: "♚", row: 0, col: 4, isLightPiece: false },
	{ piece: "♛", row: 2, col: 6, isLightPiece: false },
	{ piece: "♜", row: 4, col: 1, isLightPiece: false },
	{ piece: "♞", row: 5, col: 5, isLightPiece: false },
	{ piece: "♔", row: 7, col: 3, isLightPiece: true },
	{ piece: "♕", row: 6, col: 1, isLightPiece: true },
	{ piece: "♝", row: 3, col: 3, isLightPiece: true },
	{ piece: "♙", row: 6, col: 6, isLightPiece: true },
];

export default function LandingPage() {
	return (
		<main className="relative min-h-screen overflow-hidden bg-slate-950 px-6 py-10 text-slate-100">
			<div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(56,189,248,0.16),transparent_35%),radial-gradient(circle_at_80%_80%,rgba(168,85,247,0.16),transparent_30%)]" />

			<div className="relative mx-auto flex min-h-[calc(100vh-5rem)] w-full max-w-6xl items-center gap-10 lg:flex-row">
				<div className="w-full lg:w-1/2">
					<p className="text-sm uppercase tracking-[0.2em] text-sky-300">Knight Chess</p>
					<h1 className="mt-3 text-4xl font-bold leading-tight md:text-6xl">Play smarter. Challenge faster.</h1>
					<p className="mt-4 max-w-xl text-slate-300 md:text-lg">
						Play, chat and have fun.
					</p>

					<div className="mt-8 flex flex-wrap gap-3">
						<Link
							href="/auth"
							className="rounded-xl bg-sky-500 px-6 py-3 font-semibold text-slate-950 transition hover:bg-sky-400"
						>
							Get Started
						</Link>
					</div>
				</div>

				<div className="w-full lg:w-1/2">
					<div className="mx-auto max-w-md rounded-3xl border border-slate-700/70 bg-slate-900/80 p-4 shadow-2xl shadow-black/40 backdrop-blur">
						<div className="relative grid aspect-square grid-cols-8 overflow-hidden rounded-2xl border border-slate-700">
							{Array.from({ length: 64 }).map((_, index) => {
								const row = Math.floor(index / 8);
								const col = index % 8;
								const isLight = (row + col) % 2 === 0;

								return <div key={`${row}-${col}`} className={isLight ? "bg-slate-300" : "bg-slate-700"} />;
							})}

							{randomPieces.map((entry, index) => (
								<div
									key={`${entry.piece}-${entry.row}-${entry.col}-${index}`}
									className={`absolute flex h-[12.5%] w-[12.5%] items-center justify-center text-[clamp(1.1rem,2.2vw,1.8rem)] ${
										entry.isLightPiece ? "text-slate-100" : "text-slate-900"
									}`}
									style={{ top: `${entry.row * 12.5}%`, left: `${entry.col * 12.5}%` }}
								>
									{entry.piece}
								</div>
							))}
						</div>

						<div className="mt-3 flex items-center justify-between px-1 text-xs text-slate-400">
							<span>8</span>
							<span>{files.join("  ")}</span>
							<span>1</span>
						</div>
					</div>
				</div>
			</div>
		</main>
	);
}

