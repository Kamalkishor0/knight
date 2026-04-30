import type { Request } from "express";

export type JwtPayload = {
  username: string;
  userId: string;
  email: string;
  isGuest?: boolean;
};

export type AuthenticatedRequest = Request & {
  auth?: JwtPayload;
};
