import { verifyToken } from "../utils/jwt.js";
export function authMiddleware(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        res.status(401).json({ message: "Missing or invalid authorization header" });
        return;
    }
    const token = authHeader.split(" ")[1];
    const payload = verifyToken(token);
    if (!payload) {
        res.status(401).json({ message: "Invalid or expired token" });
        return;
    }
    req.auth = payload;
    next();
}
//# sourceMappingURL=auth.middleware.js.map