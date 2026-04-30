import { Router } from "express";
import {guest, login, loginWithGoogle, me, register, setPassword, setUsername } from "../controllers/auth.controller.js";
import { authMiddleware } from "../middleware/auth.middleware.js";

const authRouter = Router();

authRouter.post("/register", register);
authRouter.post("/login", login);
authRouter.post("/oauth/google", loginWithGoogle);
authRouter.patch("/username", authMiddleware, setUsername);
authRouter.patch("/password", authMiddleware, setPassword);
authRouter.get("/me", authMiddleware, me);
authRouter.post("/guest", guest);

export default authRouter;
