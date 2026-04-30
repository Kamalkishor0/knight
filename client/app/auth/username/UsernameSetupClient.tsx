"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { useStoredAuthToken, setStoredAuthToken, clearStoredAuthToken, supabase } from "@/lib/auth";
import { API_BASE_URL } from "@/lib/runtime-config";

const API_URL = API_BASE_URL;

export default function UsernameSetupClient() {
	const router = useRouter();
	const searchParams = useSearchParams();
	const token = useStoredAuthToken();
	const fromGoogle = searchParams.get("from") === "google";
	const [username, setUsername] = useState("");
	const [password, setPassword] = useState("");
	const [confirmPassword, setConfirmPassword] = useState("");
	const [loading, setLoading] = useState(false);
	const [bootstrapLoading, setBootstrapLoading] = useState(false);
	const [status, setStatus] = useState("");

	useEffect(() => {
		if (token) {
			return;
		}

		let cancelled = false;

		async function bootstrapBackendSession() {
			setBootstrapLoading(true);
			setStatus("Finalizing Google sign in...");

			try {
				const { data, error } = await supabase.auth.getSession();
				if (error || !data.session?.access_token) {
					if (!cancelled) {
						setStatus("Please sign in again to continue.");
					}
					return;
				}

				const response = await fetch(`${API_URL}/auth/oauth/google`, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ accessToken: data.session.access_token }),
					signal: AbortSignal.timeout(12000),
				});

				const payload = (await response.json().catch(() => null)) as { token?: string; message?: string } | null;

				if (!response.ok || !payload?.token) {
					if (!cancelled) {
						setStatus(payload?.message || "Could not finish Google sign in.");
					}
					return;
				}

				if (!cancelled) {
					setStoredAuthToken(payload.token);
					setStatus("");
				}
			} catch (error) {
				const timedOut = error instanceof DOMException && error.name === "TimeoutError";
				if (!cancelled) {
					setStatus(timedOut ? "Google sign in timed out. Please try again." : "Could not reach server.");
				}
			} finally {
				if (!cancelled) {
					setBootstrapLoading(false);
				}
			}
		}

		void bootstrapBackendSession();

		return () => {
			cancelled = true;
		};
	}, [token]);

	async function handleSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setStatus("");

		if (!token) {
			setStatus("Please sign in again to continue.");
			return;
		}

		if (!username.trim()) {
			setStatus("Username is required.");
			return;
		}

		if (fromGoogle) {
			if (!password.trim()) {
				setStatus("Create a password to enable email login.");
				return;
			}

			if (password.length < 8) {
				setStatus("Password must be at least 8 characters.");
				return;
			}

			if (password !== confirmPassword) {
				setStatus("Passwords do not match.");
				return;
			}
		}

		setLoading(true);
		try {
			const response = await fetch(`${API_URL}/auth/username`, {
				method: "PATCH",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${token}`,
				},
				body: JSON.stringify({ username }),
			});

			const data = (await response.json().catch(() => null)) as { token?: string; message?: string } | null;

			if (!response.ok || !data || !data.token) {
				setStatus(data?.message || "Could not save username.");
				return;
			}

			if (fromGoogle) {
				const passwordResponse = await fetch(`${API_URL}/auth/password`, {
					method: "PATCH",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${data.token}`,
					},
					body: JSON.stringify({ password }),
				});

				const passwordPayload = (await passwordResponse.json().catch(() => null)) as { message?: string } | null;

				if (!passwordResponse.ok) {
					setStatus(passwordPayload?.message || "Username saved, but could not set your password.");
					return;
				}
			}

			setStoredAuthToken(data.token);
			setStatus("Username saved. Redirecting...");
			router.push("/home");
		} catch {
			setStatus("Could not reach server.");
		} finally {
			setLoading(false);
		}
	}

	return (
		<main className="min-h-screen bg-slate-900 px-6 py-10 text-slate-100 flex items-center justify-center">
			<div className="mx-auto w-full max-w-md rounded-2xl border border-slate-700 bg-slate-800 p-6 shadow-lg shadow-black/20">
				<h1 className="text-2xl font-semibold">Finish setup</h1>
				<p className="mt-1 text-sm text-slate-300">Enter your username to complete your account.</p>
				{bootstrapLoading ? <p className="mt-3 text-sm text-slate-300">Finalizing Google sign in...</p> : null}

				<form onSubmit={handleSubmit} className="mt-6 space-y-3">
					<input
						type="text"
						name="username"
						autoComplete="username"
						placeholder="Enter your username"
						className="w-full rounded-md border border-slate-600 bg-slate-900 px-3 py-2 text-slate-100 placeholder:text-slate-400"
						value={username}
						onChange={(event) => setUsername(event.target.value)}
						required
					/>

					{fromGoogle ? (
						<>
							<input
								type="password"
								name="password"
								autoComplete="new-password"
								placeholder="Create a password"
								className="w-full rounded-md border border-slate-600 bg-slate-900 px-3 py-2 text-slate-100 placeholder:text-slate-400"
								value={password}
								onChange={(event) => setPassword(event.target.value)}
								required
							/>
							<input
								type="password"
								name="confirmPassword"
								autoComplete="new-password"
								placeholder="Confirm password"
								className="w-full rounded-md border border-slate-600 bg-slate-900 px-3 py-2 text-slate-100 placeholder:text-slate-400"
								value={confirmPassword}
								onChange={(event) => setConfirmPassword(event.target.value)}
								required
							/>
						</>
					) : null}

					<button
						type="submit"
						disabled={loading || bootstrapLoading}
						className="w-full rounded-md bg-slate-900 px-3 py-2 font-medium text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-70"
					>
						{loading ? "Saving..." : "Continue"}
					</button>
				</form>

				{!token ? (
					<button
						type="button"
						onClick={() => {
							clearStoredAuthToken();
							router.push("/auth");
						}}
						className="mt-3 text-sm text-slate-300 underline underline-offset-4"
					>
						Back to sign in
					</button>
				) : null}

				{status ? <p className="mt-4 text-sm text-slate-300">{status}</p> : null}
			</div>
		</main>
	);
}