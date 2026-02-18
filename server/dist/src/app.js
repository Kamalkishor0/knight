import cors from "cors";
import express from "express";
import authRouter from "./routes/auth.routes.js";
import friendsRouter from "./routes/friends.routes.js";
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.get("/health", (_req, res) => {
    res.json({ ok: true });
});
app.use("/auth", authRouter);
app.use("/friends", friendsRouter);
export default app;
//# sourceMappingURL=app.js.map