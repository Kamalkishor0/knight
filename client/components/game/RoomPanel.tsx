import type { RoomState } from "@/types/socket";

type RoomPanelProps = {
	currentRoom: RoomState | null;
	roomIdInput: string;
	onRoomIdInputChange: (value: string) => void;
	onJoinRoom: () => void;
	onCreateRoom: () => void;
};

export function RoomPanel({
	currentRoom,
	roomIdInput,
	onRoomIdInputChange,
	onJoinRoom,
	onCreateRoom,
}: RoomPanelProps) {
	return (
		<section className="rounded-2xl border border-slate-700 bg-slate-800 p-5 shadow-lg shadow-black/20">
			<h2 className="text-lg font-medium">Room</h2>
			<p className="mt-1 text-sm text-slate-300">Current: {currentRoom ? `${currentRoom.roomId} (${currentRoom.status})` : "No room"}</p>
			<div className="mt-3 flex flex-wrap gap-2">
				<input
					type="text"
					placeholder="Room ID"
					value={roomIdInput}
					onChange={(event) => onRoomIdInputChange(event.target.value.toUpperCase())}
					className="rounded-md border border-slate-600 bg-slate-900 px-3 py-2 text-slate-100 placeholder:text-slate-400"
				/>
				<button
					type="button"
					onClick={onJoinRoom}
					className="rounded bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700"
				>
					Join room
				</button>
				<button
					type="button"
					onClick={onCreateRoom}
					className="rounded bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700"
				>
					Create room
				</button>
			</div>
		</section>
	);
}
