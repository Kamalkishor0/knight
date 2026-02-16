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

    const payload = decoded as JsonWebTokenPayload;

    if (typeof payload.userId !== "number" || typeof payload.email !== "string") {
      return null;
    }

    return { userId: payload.userId, email: payload.email };
  } catch {
    return null;
  }
}
