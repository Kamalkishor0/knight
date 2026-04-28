"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useRef, useState } from "react";
import { clearStoredAuthToken, useStoredAuthToken } from "@/lib/auth";
import { connectSocket, disconnectSocket, getSocket } from "@/lib/socket";
import { API_BASE_URL, SOCKET_BASE_URL } from "@/lib/runtime-config";
import type { Ack, InviteAcceptedEvent, MatchmakingStatusEvent, RoomState } from "@/types/socket";

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
	inviteId: string;
	roomId: string;
	inviteLink: string;
	receivedAt: string;
};

type SocketClient = NonNullable<ReturnType<typeof getSocket>>;

function parseUsernameFromToken(token: string): string | null {
	try {
		const payload = token.split(".")[1];
		if (!payload) {
			return null;
		}

		const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
		const decoded = JSON.parse(atob(base64)) as { username?: string };
		return typeof decoded.username === "string" ? decoded.username : null;
	} catch {
		return null;
	}
}

export default function HomePage() {
	const router = useRouter();
	const token = useStoredAuthToken();
	const currentUsername = token ? parseUsernameFromToken(token) : null;
	const [requestedInviteId] = useState(() => {
		if (typeof window === "undefined") {
			return "";
		}

		return (new URLSearchParams(window.location.search).get("invite") || "").trim();
	});
	const [hasHydrated, setHasHydrated] = useState(false);
	const [friendUsername, setFriendUsername] = useState("");
	const [friends, setFriends] = useState<Friend[]>([]);
	const [incoming, setIncoming] = useState<IncomingRequest[]>([]);
	const [outgoing, setOutgoing] = useState<OutgoingRequest[]>([]);
	const [invites, setInvites] = useState<ReceivedInvite[]>([]);
	const [onlineUserIds, setOnlineUserIds] = useState<Set<string>>(new Set());
	const [loading, setLoading] = useState(true);
	const [status, setStatus] = useState("");
	const [isMatchmaking, setIsMatchmaking] = useState(false);
	const [isSubmittingMatchmaking, setIsSubmittingMatchmaking] = useState(false);
	const [matchmakingExpiresAt, setMatchmakingExpiresAt] = useState<number | null>(null);
	const [matchmakingSecondsLeft, setMatchmakingSecondsLeft] = useState(60);
	const acceptedInviteIdsRef = useRef<Set<string>>(new Set());

	useEffect(() => {
		if (!isMatchmaking || !matchmakingExpiresAt) {
			setMatchmakingSecondsLeft(60);
			return;
		}

		const updateCountdown = () => {
			const msLeft = Math.max(0, matchmakingExpiresAt - Date.now());
			setMatchmakingSecondsLeft(Math.ceil(msLeft / 1000));
		};

		updateCountdown();
		const timer = window.setInterval(updateCountdown, 1000);

		return () => {
			window.clearInterval(timer);
		};
	}, [isMatchmaking, matchmakingExpiresAt]);

	useEffect(() => {
		setHasHydrated(true);
	}, []);

	useEffect(() => {
		if (hasHydrated && !token) {
			router.replace("/auth");
		}
	}, [hasHydrated, router, token]);

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
	}, [router, token]);

	useEffect(() => {
		if (!token) {
			return;
		}

		const socket = connectSocket({ token, url: SOCKET_URL });

		const onOnline = (users: Array<{ userId: string; username: string }>) => {
			setOnlineUserIds(new Set(users.map((user) => user.userId)));
		};

		const onInviteReceived = (payload: { from: { userId: string; username: string }; inviteId: string; roomId: string; inviteLink: string }) => {
			setInvites((prev) => [{ ...payload, receivedAt: new Date().toLocaleTimeString() }, ...prev].slice(0, 10));
			setStatus(`Game invite received from ${payload.from.username}`);
		};

		const onInviteAccepted = (payload: InviteAcceptedEvent) => {
			setIsMatchmaking(false);
			setMatchmakingExpiresAt(null);
			setStatus(`${payload.acceptedBy.username} accepted your invite.`);
			router.push(`/game/${encodeURIComponent(payload.roomId)}`);
		};

		const onMatchmakingStatus = (payload: MatchmakingStatusEvent) => {
			if (payload.status === "searching") {
				setIsMatchmaking(true);
				setMatchmakingExpiresAt(payload.expiresAt || Date.now() + 60_000);
				setStatus(payload.message);
				return;
			}

			setIsMatchmaking(false);
			setMatchmakingExpiresAt(null);
			setStatus(payload.message);
		};

		const onMatchmakingFound = (payload: { roomId: string; opponent: { userId: string; username: string } }) => {
			setIsMatchmaking(false);
			setMatchmakingExpiresAt(null);
			setStatus(`Match found with ${payload.opponent.username}. Joining room...`);
			router.push(`/game/${encodeURIComponent(payload.roomId)}`);
		};

		socket.on("presence:online", onOnline);
		socket.on("invite:received", onInviteReceived);
		socket.on("invite:accepted", onInviteAccepted);
		socket.on("matchmaking:status", onMatchmakingStatus);
		socket.on("matchmaking:found", onMatchmakingFound);

		return () => {
			socket.off("presence:online", onOnline);
			socket.off("invite:received", onInviteReceived);
			socket.off("invite:accepted", onInviteAccepted);
			socket.off("matchmaking:status", onMatchmakingStatus);
			socket.off("matchmaking:found", onMatchmakingFound);
			disconnectSocket();
		};
	}, [router, token]);

	function getOrInitSocket() {
		return getSocket() ?? connectSocket({ token, url: SOCKET_URL });
	}

	async function waitForConnected() {
		const socket = getOrInitSocket();
		if (!socket) {
			throw new Error("Socket unavailable");
		}

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

	async function emitRoomState(socket: SocketClient) {
		return await new Promise<Ack<RoomState>>((resolve) => {
			socket.emit("room:state", (response) => resolve(response as Ack<RoomState>));
		});
	}

	async function handlePlay() {
		if (!token) {
			return;
		}
		if (isSubmittingMatchmaking) {
			return;
		}

		setIsSubmittingMatchmaking(true);
		setStatus("");

		try {
			const socket = await waitForConnected();
			const currentRoom = await emitRoomState(socket);

			if (currentRoom.ok && currentRoom.data) {
				router.push(`/game/${encodeURIComponent(currentRoom.data.roomId)}`);
				return;
			}

			if (isMatchmaking) {
				const cancelled = await new Promise<Ack>((resolve) => {
					socket.emit("matchmaking:cancel", (response) => resolve(response as Ack));
				});

				if (!cancelled.ok) {
					setStatus(cancelled.error);
				}
				return;
			}

			const joined = await new Promise<Ack<{ status: "searching"; expiresAt: number }>>((resolve) => {
				socket.emit("matchmaking:join", (response) => resolve(response as Ack<{ status: "searching"; expiresAt: number }>));
			});

			if (!joined.ok || !joined.data) {
				setStatus(joined.ok ? "Failed to start matchmaking." : joined.error);
				return;
			}

			setIsMatchmaking(true);
			setMatchmakingExpiresAt(joined.data.expiresAt);
			setStatus("Searching for an opponent...");
		} catch (error) {
			setStatus(error instanceof Error ? error.message : "Failed to start a game.");
		} finally {
			setIsSubmittingMatchmaking(false);
		}
	}

	async function handleInviteToGame(friendId: string, username: string) {
		if (!token) {
			return;
		}

		try {
			const socket = await waitForConnected();

			const invited = await new Promise<Ack<{ inviteId: string; inviteLink: string; roomId?: string }>>((resolve) => {
				socket.emit("invite:send", { toUserId: friendId }, (response) => resolve(response));
			});

			if (!invited.ok || !invited.data) {
				setStatus(invited.ok ? "Failed to send invite." : invited.error);
				return;
			}

			setStatus(`Invite sent to ${username}.`);
		} catch (error) {
			setStatus(error instanceof Error ? error.message : "Failed to invite friend.");
		}
	}

	async function acceptInviteAndGo(inviteId: string) {
		const trimmedInviteId = inviteId.trim();
		if (!trimmedInviteId) {
			setStatus("Invalid invite link.");
			return;
		}

		if (acceptedInviteIdsRef.current.has(trimmedInviteId)) {
			return;
		}

		acceptedInviteIdsRef.current.add(trimmedInviteId);

		try {
			const socket = await waitForConnected();
			const accepted = await new Promise<Ack<{ roomId: string }>>((resolve) => {
				socket.emit("invite:accept", { inviteId: trimmedInviteId }, (response) => resolve(response as Ack<{ roomId: string }>));
			});

			if (!accepted.ok || !accepted.data) {
				setStatus(accepted.ok ? "Failed to accept invite." : accepted.error);
				acceptedInviteIdsRef.current.delete(trimmedInviteId);
				return;
			}

			router.replace(`/game/${encodeURIComponent(accepted.data.roomId)}`);
		} catch (error) {
			setStatus(error instanceof Error ? error.message : "Failed to accept invite.");
			acceptedInviteIdsRef.current.delete(trimmedInviteId);
		}
	}

	useEffect(() => {
		if (!token || !requestedInviteId) {
			return;
		}

		void acceptInviteAndGo(requestedInviteId);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [requestedInviteId, token]);

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

	async function handleRemoveFriend(friendshipId: string, username: string) {
		try {
			await authFetch(`/friends/${friendshipId}`, { method: "DELETE" });
			setStatus(`Removed ${username} from friends.`);
			await refreshData();
		} catch (error) {
			setStatus(error instanceof Error ? error.message : "Failed to remove friend.");
		}
	}

	async function handleLogout() {
		const socket = getSocket();
		if (socket && isMatchmaking) {
			socket.emit("matchmaking:cancel", () => undefined);
		}

		router.replace("/auth");
		disconnectSocket();
		clearStoredAuthToken();
	}

	function handleScrollToCommunity() {
		document.getElementById("community")?.scrollIntoView({ behavior: "smooth", block: "start" });
	}

	if (!hasHydrated) {
		return null;
	}

	if (!token) {
		return (
			<main className="flex min-h-screen items-center justify-center bg-slate-950 px-6 py-10 text-slate-100">
				<p className="text-sm text-slate-300">Redirecting to authentication...</p>
			</main>
		);
	}

	const onlineFriendsCount = friends.filter((friend) => onlineUserIds.has(friend.id)).length;

	return (
		<main className="relative h-screen snap-y snap-mandatory overflow-y-auto overflow-x-hidden bg-[#08111f] text-slate-100">
			<div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(251,191,36,0.14),transparent_28%),radial-gradient(circle_at_85%_20%,rgba(56,189,248,0.18),transparent_24%),radial-gradient(circle_at_bottom,rgba(15,23,42,0.35),transparent_35%)]" />
			<div className="pointer-events-none absolute inset-0 opacity-15 bg-[linear-gradient(rgba(255,255,255,0.09)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.09)_1px,transparent_1px)] bg-size-[72px_72px]" />

			<div className="relative mx-auto w-full max-w-7xl">
				<section className="snap-start px-4 pt-6 sm:px-6 lg:px-8 lg:pt-8">
					<header className="flex items-center justify-between gap-4 px-5 py-3 backdrop-blur-xl">
						<div>
							<p className="text-xl font-extrabold uppercase tracking-[0.28em] text-amber-100">Knight</p>
						</div>
						<div className="flex flex-col items-end leading-tight">
							{currentUsername ? (
								<p className="px-4 pt-1 pb-0 text-sm font-medium text-slate-300 underline decoration-transparent">{currentUsername}</p>
							) : null}
							<button
								type="button"
								onClick={handleLogout}
								className="px-4 pt-0 pb-1 underline decoration-transparent transition-colors duration-200 hover:decoration-white"
							>
								Logout
							</button>
						</div>
					</header>

					{status ? (
						<div className="mt-3 rounded-2xl border border-amber-400/20 bg-amber-400/10 px-4 py-3 text-sm text-amber-50 shadow-lg shadow-black/10 backdrop-blur">
							{status}
						</div>
					) : null}
				</section>

				<section className="snap-start px-4 py-8 sm:px-6 lg:px-8 lg:py-10">
					<div className="mx-auto grid max-w-6xl items-center gap-6 lg:grid-cols-[1.05fr_0.95fr]">
						<div className="relative overflow-hidden rounded-4xl border border-white/10 bg-slate-950/60 p-3 shadow-2xl shadow-black/30 backdrop-blur-xl sm:p-4">
							<div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(251,191,36,0.14),transparent_42%)]" />
							<div className="relative aspect-4/3 overflow-hidden rounded-3xl border border-white/10 bg-[#10182b] p-3 sm:aspect-square">
								<div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(248,250,252,0.08),transparent_45%)]" />
								<div className="relative grid h-full grid-cols-8 overflow-hidden rounded-[1.1rem] border border-white/10 shadow-[0_30px_80px_rgba(0,0,0,0.35)]">
									{Array.from({ length: 64 }).map((_, index) => {
										const row = Math.floor(index / 8);
										const col = index % 8;
										const isLight = (row + col) % 2 === 0;

										return <div key={`${row}-${col}`} className={isLight ? "bg-[#d6cab6]" : "bg-[#7a5a3a]"} />;
									})}

									{[
										{ piece: "♚", row: 0, col: 4, isLightPiece: false },
										{ piece: "♛", row: 2, col: 6, isLightPiece: false },
										{ piece: "♜", row: 4, col: 1, isLightPiece: false },
										{ piece: "♞", row: 5, col: 5, isLightPiece: false },
										{ piece: "♔", row: 7, col: 3, isLightPiece: true },
										{ piece: "♕", row: 6, col: 1, isLightPiece: true },
										{ piece: "♝", row: 3, col: 3, isLightPiece: true },
										{ piece: "♙", row: 6, col: 6, isLightPiece: true },
									].map((entry, index) => (
										<div
											key={`${entry.piece}-${entry.row}-${entry.col}-${index}`}
											className={`absolute flex h-[12.5%] w-[12.5%] items-center justify-center text-[clamp(1.05rem,2.2vw,1.8rem)] drop-shadow-[0_8px_10px_rgba(0,0,0,0.25)] ${
												entry.isLightPiece ? "text-white" : "text-slate-950"
											}`}
											style={{ top: `${entry.row * 12.5}%`, left: `${entry.col * 12.5}%` }}
										>
											{entry.piece}
										</div>
									))}
								</div>

								<div className="mt-2 flex items-center justify-between text-[0.6rem] uppercase tracking-[0.24em] text-slate-400 sm:text-xs">
									<span>8</span>
									<span>Play smart. Play fast.</span>
									<span>1</span>
								</div>
							</div>
						</div>

						<div className="space-y-4 rounded-4xl border border-white/10 bg-white/5 p-4 shadow-2xl shadow-black/25 backdrop-blur-xl sm:p-5 lg:p-6">
							<div className="inline-flex rounded-full border border-amber-300/20 bg-amber-300/10 px-3 py-1 text-xs font-medium uppercase tracking-[0.24em] text-amber-100">
								Ready to play
							</div>
							<div className="space-y-2">
								<h1 className="max-w-xl text-3xl font-semibold leading-tight text-white sm:text-4xl">Play, Chat and have fun.</h1>
							</div>

							<div className="flex flex-wrap items-center gap-3">
								<button
									type="button"
									onClick={() => void handlePlay()}
									disabled={isSubmittingMatchmaking}
									className="inline-flex items-center justify-center rounded-full bg-linear-to-r from-amber-300 to-orange-400 px-6 py-3 text-sm font-semibold text-slate-950 shadow-lg shadow-amber-500/20 transition hover:scale-[1.02] hover:from-amber-200 hover:to-orange-300 disabled:cursor-not-allowed disabled:opacity-70"
								>
									{isSubmittingMatchmaking ? "Please wait..." : isMatchmaking ? `Cancel (${matchmakingSecondsLeft}s)` : "Play"}
								</button>
								<button
									type="button"
									onClick={handleScrollToCommunity}
									className="rounded-full border border-white/10 px-5 py-3 text-sm font-medium text-slate-200 transition hover:border-white/20 hover:bg-white/5"
								>
									See friends
								</button>
							</div>
						</div>
					</div>
				</section>

				<section id="community" className="snap-start px-4 pt-14 pb-6 sm:px-6 lg:min-h-screen lg:px-8 lg:pt-16 lg:pb-8">
					<div className="grid gap-4 lg:grid-cols-12">
					<div className="rounded-[1.75rem] border border-white/10 bg-white/5 p-4 shadow-xl shadow-black/15 backdrop-blur-xl lg:col-span-12">
						<div className="flex flex-wrap items-center justify-between gap-3">
							<div>
								<p className="text-xs uppercase tracking-[0.26em] text-slate-400">Status</p>
								<h2 className="mt-1 text-xl font-semibold text-white">Your lobby, requests, and invites</h2>
							</div>
							<p className="rounded-full border border-white/10 bg-slate-950/40 px-3 py-1 text-xs text-slate-300">
								{loading ? "Syncing latest data..." : `${friends.length} friends • ${incoming.length} incoming • ${outgoing.length} outgoing`}
							</p>
						</div>
					</div>

					<div className="rounded-[1.75rem] border border-white/10 bg-slate-950/55 p-4 shadow-xl shadow-black/15 backdrop-blur-xl lg:col-span-4">
						<h2 className="text-lg font-semibold text-white">Add friend</h2>
						<p className="mt-1 text-sm text-slate-400">Send a request and build your play list.</p>
						<form onSubmit={handleAddFriend} className="mt-4 flex gap-2">
							<input
								type="text"
								placeholder="Friend username"
								value={friendUsername}
								onChange={(event) => setFriendUsername(event.target.value)}
								className="w-full rounded-2xl border border-white/10 bg-slate-900/80 px-4 py-3 text-slate-100 placeholder:text-slate-500 focus:border-amber-300/40 focus:outline-none"
							/>
							<button
								type="submit"
								className="rounded-2xl bg-emerald-500 px-4 py-3 text-sm font-semibold text-white transition hover:bg-emerald-400"
							>
								Send
							</button>
						</form>
					</div>

					<div className="rounded-[1.75rem] border border-white/10 bg-slate-950/55 p-4 shadow-xl shadow-black/15 backdrop-blur-xl lg:col-span-8">
						<div className="flex items-center justify-between gap-2">
							<h2 className="text-lg font-semibold text-white">Game invites</h2>
							<span className="text-xs uppercase tracking-[0.25em] text-slate-400">Newest first</span>
						</div>
						<div className="mt-4 space-y-3">
							{invites.length === 0 ? <p className="text-sm text-slate-400">No invites yet.</p> : null}
							{invites.map((invite, index) => (
								<div
									key={`${invite.roomId}-${invite.receivedAt}-${index}`}
									className="flex flex-col gap-3 rounded-3xl border border-white/10 bg-white/5 p-4 sm:flex-row sm:items-center sm:justify-between"
								>
									<div>
										<p className="text-sm text-slate-200">
											<b>{invite.from.username}</b> invited you to play.
										</p>
										<p className="mt-1 text-xs text-slate-400">Room {invite.roomId} • {invite.receivedAt}</p>
									</div>
									<button
										type="button"
										onClick={() => void acceptInviteAndGo(invite.inviteId)}
										className="rounded-full bg-indigo-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-400"
									>
										Join game
									</button>
								</div>
							))}
						</div>
					</div>

					<div className="rounded-[1.75rem] border border-white/10 bg-slate-950/55 p-4 shadow-xl shadow-black/15 backdrop-blur-xl lg:col-span-6">
						<h2 className="text-lg font-semibold text-white">Incoming requests</h2>
						<p className="mt-1 text-sm text-slate-400">Approve or reject new friend requests.</p>
						<div className="mt-4 space-y-3">
							{loading ? <p className="text-sm text-slate-400">Loading...</p> : null}
							{!loading && incoming.length === 0 ? <p className="text-sm text-slate-400">No incoming requests.</p> : null}
							{incoming.map((request) => (
								<div key={request.requestId} className="rounded-3xl border border-white/10 bg-white/5 p-4">
									<p className="text-sm text-slate-100"><b>{request.from.username}</b> sent you a request.</p>
									<div className="mt-3 flex gap-2">
										<button
											type="button"
											onClick={() => handleAccept(request.requestId)}
											className="rounded-full bg-emerald-500 px-3 py-2 text-sm font-semibold text-white transition hover:bg-emerald-400"
										>
											Accept
										</button>
										<button
											type="button"
											onClick={() => handleReject(request.requestId)}
											className="rounded-full bg-rose-500 px-3 py-2 text-sm font-semibold text-white transition hover:bg-rose-400"
										>
											Reject
										</button>
									</div>
								</div>
							))}
						</div>
					</div>

					<div className="rounded-[1.75rem] border border-white/10 bg-slate-950/55 p-4 shadow-xl shadow-black/15 backdrop-blur-xl lg:col-span-6">
						<h2 className="text-lg font-semibold text-white">Outgoing requests</h2>
						<p className="mt-1 text-sm text-slate-400">Waiting for responses from other players.</p>
						<div className="mt-4 space-y-3">
							{loading ? <p className="text-sm text-slate-400">Loading...</p> : null}
							{!loading && outgoing.length === 0 ? <p className="text-sm text-slate-400">No outgoing requests.</p> : null}
							{outgoing.map((request) => (
								<div key={request.requestId} className="rounded-3xl border border-white/10 bg-white/5 p-4 text-sm text-slate-200">
									Waiting for <b>{request.to.username}</b>
								</div>
							))}
						</div>
					</div>

					<div className="rounded-[1.75rem] border border-white/10 bg-slate-950/55 p-4 shadow-xl shadow-black/15 backdrop-blur-xl lg:col-span-12">
						<div className="flex flex-wrap items-center justify-between gap-2">
							<div>
								<h2 className="text-lg font-semibold text-white">Friends list</h2>
								<p className="mt-1 text-sm text-slate-400">Invite online friends directly into a room.</p>
							</div>
							<p className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-slate-300">
								{onlineFriendsCount}/{friends.length} online
							</p>
						</div>
						<div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
							{loading ? <p className="text-sm text-slate-400">Loading...</p> : null}
							{!loading && friends.length === 0 ? <p className="text-sm text-slate-400">No friends yet.</p> : null}
							{friends.map((friend) => (
								<div key={friend.friendshipId} className="flex items-center justify-between gap-3 rounded-3xl border border-white/10 bg-white/5 p-4">
									<div>
										<p className="font-medium text-white">{friend.username}</p>
										<span
											className={`mt-2 inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${
												onlineUserIds.has(friend.id) ? "bg-emerald-500/15 text-emerald-300" : "bg-white/10 text-slate-300"
											}`}
										>
											{onlineUserIds.has(friend.id) ? "Online" : "Offline"}
										</span>
									</div>
									<div className="flex items-center gap-2">
										<button
											type="button"
											onClick={() => handleInviteToGame(friend.id, friend.username)}
											disabled={!onlineUserIds.has(friend.id)}
											className="rounded-full bg-indigo-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-400 disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-slate-400"
										>
											Invite
										</button>
										<button
											type="button"
											onClick={() => handleRemoveFriend(friend.friendshipId, friend.username)}
											aria-label={`Remove ${friend.username} from friends`}
											title={`Remove ${friend.username}`}
											className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/5 text-slate-300 transition hover:border-rose-400/30 hover:bg-rose-500/10 hover:text-rose-200"
										>
											<svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4 fill-current">
												<path d="M9 3.75A1.75 1.75 0 0 1 10.75 2h2.5A1.75 1.75 0 0 1 15 3.75V4.5h3.25a.75.75 0 0 1 0 1.5h-.7l-.74 11.14A2.75 2.75 0 0 1 14.06 20H9.94a2.75 2.75 0 0 1-2.75-2.86L6.45 6H5.75a.75.75 0 0 1 0-1.5H9v-.75Zm1.5.75v.75h3v-.75a.25.25 0 0 0-.25-.25h-2.5a.25.25 0 0 0-.25.25Zm-1.73 2.5.7 10.78c.04.62.55 1.1 1.17 1.1h4.12c.62 0 1.13-.48 1.17-1.1l.7-10.78H8.77ZM10 9.5a.75.75 0 0 1 .75.75v5a.75.75 0 0 1-1.5 0v-5A.75.75 0 0 1 10 9.5Zm4 0a.75.75 0 0 1 .75.75v5a.75.75 0 0 1-1.5 0v-5A.75.75 0 0 1 14 9.5Z" />
											</svg>
										</button>
									</div>
								</div>
							))}
						</div>
					</div>
					</div>
				</section>
			</div>
		</main>
	);
}
