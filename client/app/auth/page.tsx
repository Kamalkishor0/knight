"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useMemo, useState } from "react";
import { setStoredAuthToken } from "@/lib/auth";
import { API_BASE_URL } from "@/lib/runtime-config";

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
	const [username, setUsername] = useState("");
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [confirmPassword, setConfirmPassword] = useState("");
	const [loading, setLoading] = useState(false);
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
			if (!username.trim() || !email.trim()) {
				setStatus("Username, email and password are required.");
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
						username: username.trim().toLowerCase(),
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
			setStatus("Authentication successful. Redirecting...");
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
								type="text"
								name="username"
								autoComplete="username"
								placeholder="Username"
								className="w-full rounded-md border border-slate-600 bg-slate-900 px-3 py-2 text-slate-100 placeholder:text-slate-400"
								value={username}
								onChange={(event) => setUsername(event.target.value)}
								required
							/>
							<input
								type="email"
								name="email"
								autoComplete="email"
								placeholder="Email"
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
						{loading ? "Please wait..." : mode === "login" ? "Log in" : "Create account"}
					</button>
				</form>

				{status ? <p className="mt-4 text-sm text-slate-300">{status}</p> : null}
			</div>
		</main>
	);
}
