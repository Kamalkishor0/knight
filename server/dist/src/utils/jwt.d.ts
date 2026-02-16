import type { JwtPayload } from "../types/auth.js";
export declare function signToken(payload: JwtPayload): string;
export declare function verifyToken(token: string): JwtPayload | null;
