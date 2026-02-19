"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { clearStoredAuthToken, getStoredAuthToken } from "@/lib/auth";
import { connectSocket, disconnectSocket, getSocket } from "@/lib/socket";
import { API_BASE_URL, SOCKET_BASE_URL } from "@/lib/runtime-config";
import type { Ack, RoomState } from "@/types/socket";

const API_URL = API_BASE_URL;
const SOCKET_URL = SOCKET_BASE_URL;

type Friend = {
	id: string;
	username: string;
	friendshipId: string;
};

type IncomingRequest = {
	requestId: string;
	from: { id: string; username: string };
	createdAt: string;
};

type OutgoingRequest = {
	requestId: string;
	to: { id: string; username: string };
	createdAt: string;
};

type ReceivedInvite = {
	from: { userId: string; username: string };
	roomId: string;
	inviteLink: string;
	receivedAt: string;
};

export default function FriendsPage() {
	const router = useRouter();
	const [token] = useState(() => getStoredAuthToken());
	const [friendUsername, setFriendUsername] = useState("");
	const [friends, setFriends] = useState<Friend[]>([]);
	const [incoming, setIncoming] = useState<IncomingRequest[]>([]);
	const [outgoing, setOutgoing] = useState<OutgoingRequest[]>([]);
	const [invites, setInvites] = useState<ReceivedInvite[]>([]);
	const [onlineUserIds, setOnlineUserIds] = useState<Set<string>>(new Set());
	const [loading, setLoading] = useState(true);
	const [status, setStatus] = useState("");

	useEffect(() => {
		if (!token) {
			router.replace("/");
		}
	}, [router, token]);

	async function authFetch(path: string, init?: RequestInit) {
		const response = await fetch(`${API_URL}${path}`, {
			...init,
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${token}`,
				...(init?.headers || {}),
			},
		});

		const data = (await response.json().catch(() => null)) as
			| {
					message?: string;
					friends?: Friend[];
					incoming?: IncomingRequest[];
					outgoing?: OutgoingRequest[];
			  }
			| null;

		if (!response.ok) {
			throw new Error(data?.message || "Request failed");
		}

		return data;
	}

	async function refreshData() {
		if (!token) {
			return;
		}

		setLoading(true);
		setStatus("");
		try {
			const [friendsResponse, requestsResponse] = await Promise.all([authFetch("/friends"), authFetch("/friends/requests")]);
			setFriends(friendsResponse?.friends || []);
			setIncoming(requestsResponse?.incoming || []);
			setOutgoing(requestsResponse?.outgoing || []);
		} catch (error) {
			setStatus(error instanceof Error ? error.message : "Failed to load data.");
		} finally {
			setLoading(false);
		}
	}

	useEffect(() => {
		void refreshData();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [token]);

	useEffect(() => {
		if (!token) {
			return;
		}

		const socket = connectSocket({ token, url: SOCKET_URL });

		const onOnline = (users: Array<{ userId: string; username: string }>) => {
			setOnlineUserIds(new Set(users.map((user) => user.userId)));
		};

		const onInviteReceived = (payload: { from: { userId: string; username: string }; roomId: string; inviteLink: string }) => {
			setInvites((prev) => [{ ...payload, receivedAt: new Date().toLocaleTimeString() }, ...prev].slice(0, 10));
			setStatus(`Game invite received from ${payload.from.username}`);
		};

		socket.on("presence:online", onOnline);
		socket.on("invite:received", onInviteReceived);

		return () => {
			socket.off("presence:online", onOnline);
			socket.off("invite:received", onInviteReceived);
			disconnectSocket();
		};
	}, [token]);

	function getOrInitSocket() {
		return getSocket() ?? connectSocket({ token, url: SOCKET_URL });
	}

	async function waitForConnected() {
		const socket = getOrInitSocket();

		if (socket.connected) {
			return socket;
		}

		await new Promise<void>((resolve, reject) => {
			const timeoutId = window.setTimeout(() => {
				socket.off("connect", onConnect);
				socket.off("connect_error", onConnectError);
				reject(new Error("Socket connection timeout"));
			}, 6000);

			const onConnect = () => {
				window.clearTimeout(timeoutId);
				socket.off("connect_error", onConnectError);
				resolve();
			};

			const onConnectError = () => {
				window.clearTimeout(timeoutId);
				socket.off("connect", onConnect);
				reject(new Error("Failed to connect socket"));
			};

			socket.once("connect", onConnect);
			socket.once("connect_error", onConnectError);
		});

		return socket;
	}

	async function getOrCreateRoomId(): Promise<string> {
		const socket = await waitForConnected();

		const roomState = await new Promise<Ack<RoomState>>((resolve) => {
			socket.emit("room:state", (response) => resolve(response));
		});

		if (roomState.ok && roomState.data) {
			return roomState.data.roomId;
		}

		const created = await new Promise<Ack<RoomState>>((resolve) => {
			socket.emit("room:create", {}, (response) => resolve(response));
		});

		if (!created.ok || !created.data) {
			throw new Error(created.ok ? "Failed to create room." : created.error);
		}

		return created.data.roomId;
	}

	async function handleInviteToGame(friendId: string, username: string) {
		if (!token) {
			return;
		}

		try {
			const socket = await waitForConnected();
			const roomId = await getOrCreateRoomId();

			const invited = await new Promise<Ack<{ inviteLink: string; roomId: string }>>((resolve) => {
				socket.emit("invite:send", { toUserId: friendId, roomId }, (response) => resolve(response));
			});

			if (!invited.ok || !invited.data) {
				setStatus(invited.ok ? "Failed to send invite." : invited.error);
				return;
			}

			setStatus(`Invite sent to ${username}.`);
			router.push(`/game?room=${encodeURIComponent(invited.data.roomId)}`);
		} catch (error) {
			setStatus(error instanceof Error ? error.message : "Failed to invite friend.");
		}
	}

	async function handleAddFriend(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (!friendUsername.trim()) {
			setStatus("Enter a username.");
			return;
		}

		try {
			await authFetch("/friends/request", {
				method: "POST",
				body: JSON.stringify({ username: friendUsername.trim().toLowerCase() }),
			});
			setFriendUsername("");
			setStatus("Friend request sent.");
			await refreshData();
		} catch (error) {
			setStatus(error instanceof Error ? error.message : "Failed to send friend request.");
		}
	}

	async function handleAccept(requestId: string) {
		try {
			await authFetch(`/friends/request/${requestId}/accept`, { method: "POST" });
			setStatus("Friend request accepted.");
			await refreshData();
		} catch (error) {
			setStatus(error instanceof Error ? error.message : "Failed to accept request.");
		}
	}

	async function handleReject(requestId: string) {
		try {
			await authFetch(`/friends/request/${requestId}/reject`, { method: "POST" });
			setStatus("Friend request rejected.");
			await refreshData();
		} catch (error) {
			setStatus(error instanceof Error ? error.message : "Failed to reject request.");
		}
	}

	function handleLogout() {
		disconnectSocket();
		clearStoredAuthToken();
		router.replace("/");
	}

	if (!token) {
		return null;
	}

	const onlineFriendsCount = friends.filter((friend) => onlineUserIds.has(friend.id)).length;

	return (
		<main className="min-h-screen bg-slate-900 px-6 py-10 text-slate-100">
			<div className="mx-auto grid w-full max-w-4xl gap-4">
				<header className="rounded-2xl border border-slate-700 bg-slate-800 p-5 shadow-lg shadow-black/20">
					<div className="flex items-center justify-between gap-3">
						<div>
							<h1 className="text-2xl font-semibold">Friends</h1>
							<p className="text-sm text-slate-300">Send requests by username and accept incoming requests.</p>
						</div>
						<button
							type="button"
							onClick={handleLogout}
							className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700"
						>
							Logout
						</button>
					</div>
					{status ? <p className="mt-3 text-sm text-slate-300">{status}</p> : null}
				</header>

				<section className="rounded-2xl border border-slate-700 bg-slate-800 p-5 shadow-lg shadow-black/20">
					<h2 className="text-lg font-medium">Add friend</h2>
					<form onSubmit={handleAddFriend} className="mt-3 flex gap-2">
						<input
							type="text"
							placeholder="Friend username"
							value={friendUsername}
							onChange={(event) => setFriendUsername(event.target.value)}
							className="w-full rounded-md border border-slate-600 bg-slate-900 px-3 py-2 text-slate-100 placeholder:text-slate-400"
						/>
						<button
							type="submit"
							className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
						>
							Send
						</button>
					</form>
				</section>

				<section className="rounded-2xl border border-slate-700 bg-slate-800 p-5 shadow-lg shadow-black/20">
					<h2 className="text-lg font-medium">Game invites</h2>
					<ul className="mt-3 space-y-2 text-sm">
						{invites.length === 0 ? <li className="text-slate-400">No invites yet.</li> : null}
						{invites.map((invite, index) => (
							<li key={`${invite.roomId}-${invite.receivedAt}-${index}`} className="rounded-md border border-slate-700 bg-slate-900/50 p-2">
								<div className="flex items-center justify-between gap-2">
									<div>
										<p>
											<b>{invite.from.username}</b> invited you to play.
										</p>
										<p className="text-xs text-slate-400">Room: {invite.roomId}</p>
									</div>
									<button
										type="button"
										onClick={() => router.push(`/game?room=${encodeURIComponent(invite.roomId)}`)}
										className="rounded bg-indigo-600 px-3 py-1 text-white hover:bg-indigo-700"
									>
										Join game
									</button>
								</div>
							</li>
						))}
					</ul>
				</section>

				<div className="grid gap-4 md:grid-cols-3">
					<section className="rounded-2xl border border-slate-700 bg-slate-800 p-5 shadow-lg shadow-black/20">
						<h2 className="text-lg font-medium">Incoming</h2>
						{loading ? <p className="mt-3 text-sm text-slate-400">Loading...</p> : null}
						<ul className="mt-3 space-y-2 text-sm">
							{!loading && incoming.length === 0 ? <li className="text-slate-400">No incoming requests.</li> : null}
							{incoming.map((request) => (
								<li key={request.requestId} className="rounded-md border border-slate-700 bg-slate-900/50 p-2">
									<p>
										<b>{request.from.username}</b>
									</p>
									<div className="mt-2 flex gap-2">
										<button
											type="button"
											onClick={() => handleAccept(request.requestId)}
											className="rounded bg-emerald-600 px-2 py-1 text-white hover:bg-emerald-700"
										>
											Accept
										</button>
										<button
											type="button"
											onClick={() => handleReject(request.requestId)}
											className="rounded bg-rose-600 px-2 py-1 text-white hover:bg-rose-700"
										>
											Reject
										</button>
									</div>
								</li>
							))}
						</ul>
					</section>

					<section className="rounded-2xl border border-slate-700 bg-slate-800 p-5 shadow-lg shadow-black/20">
						<h2 className="text-lg font-medium">Outgoing</h2>
						{loading ? <p className="mt-3 text-sm text-slate-400">Loading...</p> : null}
						<ul className="mt-3 space-y-2 text-sm">
							{!loading && outgoing.length === 0 ? <li className="text-slate-400">No outgoing requests.</li> : null}
							{outgoing.map((request) => (
								<li key={request.requestId} className="rounded-md border border-slate-700 bg-slate-900/50 p-2">
									Waiting for <b>{request.to.username}</b>
								</li>
							))}
						</ul>
					</section>

					<section className="rounded-2xl border border-slate-700 bg-slate-800 p-5 shadow-lg shadow-black/20">
						<div className="flex items-center justify-between gap-2">
							<h2 className="text-lg font-medium">Friends list</h2>
							<p className="text-xs text-slate-400">{onlineFriendsCount}/{friends.length} online</p>
						</div>
						{loading ? <p className="mt-3 text-sm text-slate-400">Loading...</p> : null}
						<ul className="mt-3 space-y-2 text-sm">
							{!loading && friends.length === 0 ? <li className="text-slate-400">No friends yet.</li> : null}
							{friends.map((friend) => (
								<li key={friend.friendshipId} className="flex items-center justify-between rounded-md border border-slate-700 bg-slate-900/50 p-2">
									<div className="flex items-center gap-2">
										<span>{friend.username}</span>
										<span
											className={`rounded-full px-2 py-0.5 text-xs font-medium ${
												onlineUserIds.has(friend.id) ? "bg-emerald-900/40 text-emerald-300" : "bg-slate-700 text-slate-300"
											}`}
										>
											{onlineUserIds.has(friend.id) ? "Online" : "Offline"}
										</span>
									</div>
									<button
										type="button"
										onClick={() => handleInviteToGame(friend.id, friend.username)}
										disabled={!onlineUserIds.has(friend.id)}
										className="rounded bg-indigo-600 px-3 py-1 text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-700"
									>
										Invite
									</button>
								</li>
							))}
						</ul>
					</section>
				</div>
			</div>
		</main>
	);
}
