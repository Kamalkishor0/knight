import type { Request } from "express";
export type JwtPayload = {
    userId: number;
    email: string;
};
export type AuthenticatedRequest = Request & {
    auth?: JwtPayload;
};
