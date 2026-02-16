import cors from "cors";
import express from "express";
import type { Request, Response } from "express";
import authRouter from "./routes/auth.routes.js";

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.get("/health", (_req: Request, res: Response) => {
  res.json({ ok: true });
});

app.use("/auth", authRouter);

export default app;
