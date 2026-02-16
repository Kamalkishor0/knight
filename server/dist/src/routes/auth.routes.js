import { Router } from "express";
import { login, me, register } from "../controllers/auth.controller.js";
import { authMiddleware } from "../middleware/auth.middleware.js";
const authRouter = Router();
authRouter.post("/register", register);
authRouter.post("/login", login);
authRouter.get("/me", authMiddleware, me);
export default authRouter;
//# sourceMappingURL=auth.routes.js.map