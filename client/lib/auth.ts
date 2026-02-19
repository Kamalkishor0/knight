import { useSyncExternalStore } from "react";

export const AUTH_TOKEN_STORAGE_KEY = "knight-auth-token";

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

	window.addEventListener("storage", onStorage);
	return () => window.removeEventListener("storage", onStorage);
}

export function useStoredAuthToken() {
	return useSyncExternalStore(subscribeAuthToken, getStoredAuthToken, () => "");
}
