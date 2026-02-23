import { useSyncExternalStore } from "react";

export const AUTH_TOKEN_STORAGE_KEY = "knight-auth-token";
const AUTH_TOKEN_CHANGE_EVENT = "knight-auth-token-change";

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
