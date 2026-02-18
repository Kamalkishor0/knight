"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useMemo, useState } from "react";

const STORAGE_KEY = "knight-auth-token";
const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";

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

export default function LandingPage() {
	const router = useRouter();
	const [mode, setMode] = useState<AuthMode>("login");
	const [usernameOrEmail, setUsernameOrEmail] = useState("");
	const [username, setUsername] = useState("");
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
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

			if (!response.ok || !data || !("token" in data)) {
				setStatus(data && "message" in data && data.message ? data.message : "Authentication failed.");
				return;
			}

			window.localStorage.setItem(STORAGE_KEY, data.token);
			setStatus("Authentication successful. Redirecting...");
			router.push("/friends");
		} catch {
			setStatus("Could not reach server.");
		} finally {
			setLoading(false);
		}
	}

	return (
		<main className="min-h-screen bg-slate-50 px-6 py-10 text-slate-900">
			<div className="mx-auto w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
				<h1 className="text-2xl font-semibold">Knight</h1>
				<p className="mt-1 text-sm text-slate-600">Welcome. Log in or sign up to manage your friends.</p>

				<div className="mt-6 grid grid-cols-2 rounded-lg bg-slate-100 p-1 text-sm">
					<button
						type="button"
						onClick={() => {
							setMode("login");
							setStatus("");
						}}
						className={`rounded-md px-3 py-2 font-medium ${mode === "login" ? "bg-white shadow" : "text-slate-600"}`}
					>
						Login
					</button>
					<button
						type="button"
						onClick={() => {
							setMode("signup");
							setStatus("");
						}}
						className={`rounded-md px-3 py-2 font-medium ${mode === "signup" ? "bg-white shadow" : "text-slate-600"}`}
					>
						Signup
					</button>
				</div>

				<h2 className="mt-6 text-lg font-medium">{heading}</h2>
				<form onSubmit={handleSubmit} className="mt-4 space-y-3">
					{mode === "signup" ? (
						<>
							<input
								type="text"
								placeholder="Username"
								className="w-full rounded-md border border-slate-300 px-3 py-2"
								value={username}
								onChange={(event) => setUsername(event.target.value)}
								required
							/>
							<input
								type="email"
								placeholder="Email"
								className="w-full rounded-md border border-slate-300 px-3 py-2"
								value={email}
								onChange={(event) => setEmail(event.target.value)}
								required
							/>
						</>
					) : (
						<input
							type="text"
							placeholder="Username or email"
							className="w-full rounded-md border border-slate-300 px-3 py-2"
							value={usernameOrEmail}
							onChange={(event) => setUsernameOrEmail(event.target.value)}
							required
						/>
					)}

					<input
						type="password"
						placeholder="Password"
						className="w-full rounded-md border border-slate-300 px-3 py-2"
						value={password}
						onChange={(event) => setPassword(event.target.value)}
						required
					/>

					<button
						type="submit"
						disabled={loading}
						className="w-full rounded-md bg-slate-900 px-3 py-2 font-medium text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-70"
					>
						{loading ? "Please wait..." : mode === "login" ? "Log in" : "Create account"}
					</button>
				</form>

				{status ? <p className="mt-4 text-sm text-slate-700">{status}</p> : null}
			</div>
		</main>
	);
}

