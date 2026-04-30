import { useSyncExternalStore } from "react";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
	throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY.");
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export async function signInWithOauth(redirectTo?: string) {
	await supabase.auth.signInWithOAuth({
		provider: "google",
		options: redirectTo ? { redirectTo } : undefined,
	});
}


export const AUTH_TOKEN_STORAGE_KEY = "knight-auth-token";
const AUTH_TOKEN_CHANGE_EVENT = "knight-auth-token-change";

export type AuthTokenPayload = {
	username?: string;
	userId?: string;
	email?: string;
	isGuest?: boolean;
};

function notifyAuthTokenChanged() {
	if (typeof window === "undefined") {
		return;
	}

	window.dispatchEvent(new Event(AUTH_TOKEN_CHANGE_EVENT));
}

export function getStoredAuthToken() {
	if (typeof window === "undefined") {
		return "";
	}

	return window.localStorage.getItem(AUTH_TOKEN_STORAGE_KEY) || "";
}

export function decodeAuthToken(token: string): AuthTokenPayload | null {
	try {
		const payload = token.split(".")[1];
		if (!payload) {
			return null;
		}

		const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
		const decoded = JSON.parse(atob(base64)) as AuthTokenPayload;
		return decoded;
	} catch {
		return null;
	}
}

export function clearStoredAuthToken() {
	if (typeof window === "undefined") {
		return;
	}

	window.localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
	notifyAuthTokenChanged();
}

export function setStoredAuthToken(token: string) {
	if (typeof window === "undefined") {
		return;
	}

	window.localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, token);
	notifyAuthTokenChanged();
}

function subscribeAuthToken(onStoreChange: () => void) {
	if (typeof window === "undefined") {
		return () => {};
	}

	const onStorage = (event: StorageEvent) => {
		if (!event.key || event.key === AUTH_TOKEN_STORAGE_KEY) {
			onStoreChange();
		}
	};

	const onTokenChange = () => {
		onStoreChange();
	};

	window.addEventListener("storage", onStorage);
	window.addEventListener(AUTH_TOKEN_CHANGE_EVENT, onTokenChange);
	return () => {
		window.removeEventListener("storage", onStorage);
		window.removeEventListener(AUTH_TOKEN_CHANGE_EVENT, onTokenChange);
	};
}

export function useStoredAuthToken() {
	return useSyncExternalStore(subscribeAuthToken, getStoredAuthToken, () => "");
}