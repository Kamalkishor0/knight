import type { MoveLogItem } from "@/app/game/types";

type MovesPanelProps = {
	moves: MoveLogItem[];
};

export function MovesPanel({ moves }: MovesPanelProps) {
	return (
		<div className="rounded-2xl border border-slate-700 bg-slate-800 p-5 shadow-lg shadow-black/20">
			<h2 className="text-lg font-medium">Moves</h2>
			<ul className="mt-3 max-h-125 space-y-2 overflow-auto text-sm">
				{moves.length === 0 ? <li className="text-slate-400">No moves yet.</li> : null}
				{moves.map((move, index) => (
					<li key={`${move.at}-${index}`} className="rounded border border-slate-700 bg-slate-900/50 p-2">
						#{index + 1} <b>{move.byLabel}</b>: {move.san} ({move.from}→{move.to})
					</li>
				))}
			</ul>
		</div>
	);
}
