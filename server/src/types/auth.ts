import type { Request } from "express";

export type JwtPayload = {
  username: string;
  userId: string;
  email: string;
};

export type AuthenticatedRequest = Request & {
  auth?: JwtPayload;
};
