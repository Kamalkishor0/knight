"use client";
import { useRouter } from "next/navigation";
import { FormEvent, useMemo, useState } from "react";
import { setStoredAuthToken } from "@/lib/auth";
import { API_BASE_URL } from "@/lib/runtime-config";
import { signInWithOauth } from "@/lib/auth";
const API_URL = API_BASE_URL;

type AuthMode = "login" | "signup";

type User = {
	id: string;
	username: string;
	email: string;
	createdAt: string;
};

type AuthResponse = {
	token: string;
	user: User;
};

export default function AuthPage() {
	const router = useRouter();
	const [mode, setMode] = useState<AuthMode>("login");
	const [usernameOrEmail, setUsernameOrEmail] = useState("");
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [confirmPassword, setConfirmPassword] = useState("");
	const [loading, setLoading] = useState(false);
	const [googleLoading, setGoogleLoading] = useState(false);
	const [status, setStatus] = useState("");

	const heading = useMemo(() => (mode === "login" ? "Log in to Knight" : "Create your Knight account"), [mode]);

	async function handleSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setStatus("");

		if (!password.trim()) {
			setStatus("Password is required.");
			return;
		}

		if (mode === "signup") {
			if (!email.trim()) {
				setStatus("Email and password are required.");
				return;
			}

			if (password !== confirmPassword) {
				setStatus("Passwords do not match.");
				return;
			}
		} else if (!usernameOrEmail.trim()) {
			setStatus("Enter your username or email.");
			return;
		}

		setLoading(true);
		try {
			const endpoint = mode === "login" ? "/auth/login" : "/auth/register";
			const body =
				mode === "login"
					? {
						password,
						...(usernameOrEmail.includes("@")
							? { email: usernameOrEmail.trim().toLowerCase() }
							: { username: usernameOrEmail.trim().toLowerCase() }),
					}
					: {
						email: email.trim().toLowerCase(),
						password,
					};

			const response = await fetch(`${API_URL}${endpoint}`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body),
			});

			const data = (await response.json().catch(() => null)) as AuthResponse | { message?: string } | null;

			if (!response.ok || !data || !('token' in data)) {
				setStatus(data && "message" in data && data.message ? data.message : "Authentication failed.");
				return;
			}

			setStoredAuthToken(data.token);
			if (mode === "signup") {
				setStatus("Account created. Set your username next.");
				router.push("/auth/username");
				return;
			}

			setStatus("Authentication successful. Redirecting...");
			router.push("/home");
		} catch {
			setStatus("Could not reach server.");
		} finally {
			setLoading(false);
		}
	}

	async function handleGoogleSignIn() {
		setStatus("");
		setGoogleLoading(true);
		try {
			await signInWithOauth(`${window.location.origin}/auth/username?from=google`);
		} catch {
			setStatus("Could not start Google sign in.");
			setGoogleLoading(false);
		}
	}

	async function handleGuestSignIn() {
		setStatus("");
		setLoading(true);
		try {
			const response = await fetch(`${API_URL}/auth/guest`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
			});

			const data = (await response.json().catch(() => null)) as AuthResponse | { message?: string } | null;
			if (!response.ok || !data || !("token" in data)) {
				setStatus(data && "message" in data && data.message ? data.message : "Guest sign in failed.");
				return;
			}

			setStoredAuthToken(data.token);
			setStatus("Continuing as guest...");
			router.push("/home");
		} catch {
			setStatus("Could not start guest session.");
		} finally {
			setLoading(false);
		}
	}

	return (
		<main className="min-h-screen bg-slate-900 px-6 py-10 text-slate-100 flex items-center justify-center">
			<div className="mx-auto w-full max-w-md rounded-2xl border border-slate-700 bg-slate-800 p-6 shadow-lg shadow-black/20">
				<h1 className="text-2xl font-semibold">Knight</h1>
				<p className="mt-1 text-sm text-slate-300">Welcome. Log in or sign up to continue.</p>

				<div className="mt-6 grid grid-cols-2 rounded-lg bg-slate-700 p-1 text-sm">
					<button
						type="button"
						onClick={() => {
							setMode("login");
							setStatus("");
							setConfirmPassword("");
						}}
						className={`rounded-md px-3 py-2 font-medium ${mode === "login" ? "bg-slate-800 text-white shadow" : "text-slate-300"}`}
					>
						Login
					</button>
					<button
						type="button"
						onClick={() => {
							setMode("signup");
							setStatus("");
							setConfirmPassword("");
						}}
						className={`rounded-md px-3 py-2 font-medium ${mode === "signup" ? "bg-slate-800 text-white shadow" : "text-slate-300"}`}
					>
						Signup
					</button>
				</div>

				<h2 className="mt-6 text-lg font-medium">{heading}</h2>
				<form onSubmit={handleSubmit} className="mt-4 space-y-3" autoComplete="on">
					{mode === "signup" ? (
						<>
							<input
								type="email"
								name="email"
								autoComplete="email"
								placeholder="Email address"
								className="w-full rounded-md border border-slate-600 bg-slate-900 px-3 py-2 text-slate-100 placeholder:text-slate-400"
								value={email}
								onChange={(event) => setEmail(event.target.value)}
								required
							/>
						</>
					) : (
						<input
							type="text"
							name="usernameOrEmail"
							autoComplete="username"
							placeholder="Username or email"
							className="w-full rounded-md border border-slate-600 bg-slate-900 px-3 py-2 text-slate-100 placeholder:text-slate-400"
							value={usernameOrEmail}
							onChange={(event) => setUsernameOrEmail(event.target.value)}
							required
						/>
					)}

					<input
						type="password"
						name="password"
						autoComplete={mode === "login" ? "current-password" : "new-password"}
						placeholder="Password"
						className="w-full rounded-md border border-slate-600 bg-slate-900 px-3 py-2 text-slate-100 placeholder:text-slate-400"
						value={password}
						onChange={(event) => setPassword(event.target.value)}
						required
					/>

					{mode === "signup" ? (
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
					) : null}

					<button
						type="submit"
						disabled={loading}
						className="w-full rounded-md bg-slate-900 px-3 py-2 font-medium text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-70"
					>
						{loading ? "Please wait..." : mode === "login" ? "Log in" : "Create Account"}
					</button>

					{mode === "signup" ? (
						<button
							type="button"
							disabled={googleLoading}
							onClick={handleGoogleSignIn}
							className="flex w-full items-center justify-center gap-2 rounded-md border border-slate-600 bg-slate-900 px-3 py-2 font-medium text-slate-100 transition hover:border-slate-500 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-70"
						>
							<svg aria-hidden="true" viewBox="0 0 48 48" className="h-6 w-6 shrink-0" fill="none">
								<path fill="#FFC107" d="M43.611 20.083H42V20H24v8h11.303C33.655 32.659 29.2 36 24 36c-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.085 6.053 29.368 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.651-.389-3.917Z" />
								<path fill="#FF3D00" d="M6.306 14.691 12.876 19.5C14.655 15.109 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.085 6.053 29.368 4 24 4 16.318 4 9.655 8.337 6.306 14.691Z" />
								<path fill="#4CAF50" d="M24 44c5.259 0 9.883-2.018 13.409-5.302l-6.19-5.238C29.17 35.91 26.749 36.999 24 37c-5.179 0-9.62-3.29-11.303-7.923l-6.53 5.037C9.47 39.556 16.142 44 24 44Z" />
								<path fill="#1976D2" d="M43.611 20.083H42V20H24v8h11.303a11.99 11.99 0 0 1-4.084 5.46l.003-.002 6.19 5.238C36.971 39.421 44 34 44 24c0-1.341-.138-2.651-.389-3.917Z" />
							</svg>
							{googleLoading ? "Connecting to Google..." : "Continue with Google"}
						</button>
					) : null}
					</form>

					<button
						type="button"
						disabled={loading}
						onClick={() => void handleGuestSignIn()}
						className="mt-3 flex w-full items-center justify-center rounded-md border border-amber-400/30 bg-amber-400/10 px-3 py-2 font-medium text-amber-100 transition hover:border-amber-300/50 hover:bg-amber-400/15 disabled:cursor-not-allowed disabled:opacity-70"
					>
						{loading ? "Creating guest session..." : "Continue as guest"}
					</button>

					<p className="mt-3 text-xs leading-5 text-slate-400">
						After signup or Google sign in, you will be asked to choose your username.
					</p>

				{status ? <p className="mt-4 text-sm text-slate-300">{status}</p> : null}
			</div>
		</main>
	);
}
