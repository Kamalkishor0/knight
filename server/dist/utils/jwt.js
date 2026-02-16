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
        if (typeof payload.userId !== "number" || typeof payload.email !== "string") {
            return null;
        }
        return { userId: payload.userId, email: payload.email };
    }
    catch {
        return null;
    }
}
//# sourceMappingURL=jwt.js.map