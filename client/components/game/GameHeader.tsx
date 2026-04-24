type GameHeaderProps = {
	status: string;
	connected: boolean;
	hasRoom: boolean;
	onLeaveRoom: () => void;
};

export function GameHeader({ status, connected, hasRoom, onLeaveRoom }: GameHeaderProps) {
	return (
		<header className="rounded-2xl border border-slate-700 bg-slate-800 p-5 shadow-lg shadow-black/20">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<div>
					<h1 className="text-2xl font-semibold">Chess Game</h1>
					<p className="text-sm text-slate-300">Status: {status}</p>
					<p className="text-sm text-slate-300">Connection: {connected ? "Connected" : "Disconnected"}</p>
				</div>
				<div className="flex gap-2">
					{hasRoom ? (
						<button
							type="button"
							onClick={onLeaveRoom}
							className="rounded bg-rose-600 px-3 py-2 text-sm font-medium text-white hover:bg-rose-700"
						>
							Leave room
						</button>
					) : null}
				</div>
			</div>
		</header>
	);
}
