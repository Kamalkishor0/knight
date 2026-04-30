import jwt, { type JwtPayload as JsonWebTokenPayload } from "jsonwebtoken";
import env from "../config/env.js";
import type { JwtPayload } from "../types/auth.js";

export function signToken(payload: JwtPayload) {
  return jwt.sign(payload, env.jwtSecret, { expiresIn: "7d" });
}

export function verifyToken(token: string): JwtPayload | null {
  try {
    const decoded = jwt.verify(token, env.jwtSecret);

    if (typeof decoded !== "object" || decoded === null) {
      return null;
    }

    const payload = decoded as JsonWebTokenPayload & Record<string, unknown>;
    const userId = payload.userId;
    const email = payload.email;
    const username = payload.username;
    const isGuest = payload.isGuest;

    if (typeof userId !== "string" || typeof email !== "string" || typeof username !== "string") {
      return null;
    }

    if (typeof isGuest !== "undefined" && typeof isGuest !== "boolean") {
      return null;
    }

    return { username, userId, email, isGuest: isGuest === true };
  } catch {
    return null;
  }
}
