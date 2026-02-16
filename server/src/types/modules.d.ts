declare module "cors" {
	const cors: (...args: any[]) => any;
	export default cors;
}

declare module "jsonwebtoken" {
	export interface JwtPayload {
		[key: string]: unknown;
		userId?: number;
		email?: string;
	}

	export function sign(payload: string | object | Buffer, secretOrPrivateKey: string, options?: unknown): string;
	export function verify(token: string, secretOrPublicKey: string): string | JwtPayload;

	const jwt: {
		sign: typeof sign;
		verify: typeof verify;
	};

	export default jwt;
}

declare module "express" {
	export type NextFunction = (...args: any[]) => void;

	export interface Request {
		headers: Record<string, string | undefined>;
		body: any;
		[key: string]: any;
	}

	export interface Response {
		status(code: number): Response;
		json(body?: any): Response;
	}

	export interface Router {
		use(...args: any[]): Router;
		get(...args: any[]): Router;
		post(...args: any[]): Router;
	}

	export interface Application {
		use(...args: any[]): Application;
		get(...args: any[]): Application;
		post(...args: any[]): Application;
		listen(port: number, callback?: () => void): void;
	}

	export function Router(): Router;

	interface ExpressFactory {
		(): Application;
		json(): any;
		urlencoded(options?: { extended?: boolean }): any;
	}

	const express: ExpressFactory;
	export default express;
}
