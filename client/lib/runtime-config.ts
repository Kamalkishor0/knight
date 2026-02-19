const DEFAULT_BACKEND_URL = "http://localhost:3001";

function normalizeBaseUrl(url: string) {
	return url.trim().replace(/\/+$/, "");
}

const rawApiUrl = process.env.NEXT_PUBLIC_API_URL;
const rawSocketUrl = process.env.NEXT_PUBLIC_SOCKET_URL;

export const API_BASE_URL = normalizeBaseUrl(rawApiUrl && rawApiUrl.trim() ? rawApiUrl : DEFAULT_BACKEND_URL);
export const SOCKET_BASE_URL = normalizeBaseUrl(rawSocketUrl && rawSocketUrl.trim() ? rawSocketUrl : API_BASE_URL);
