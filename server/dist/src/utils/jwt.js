import jwt from "jsonwebtoken";
import env from "../config/env.js";
export function signToken(payload) {
    return jwt.sign(payload, env.jwtSecret, { expiresIn: "7d" });
}
export function verifyToken(token) {
    try {
        const decoded = jwt.verify(token, env.jwtSecret);
        if (typeof decoded !== "object" || decoded === null) {
            return null;
        }
        const payload = decoded;
        const userId = payload.userId;
        const email = payload.email;
        const username = payload.username;
        if (typeof userId !== "string" || typeof email !== "string" || typeof username !== "string") {
            return null;
        }
        return { username, userId, email };
    }
    catch {
        return null;
    }
}
//# sourceMappingURL=jwt.js.map