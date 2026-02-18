import { createServer } from "node:http";
import { Server } from "socket.io";
import app from "./src/app.js";
import env from "./src/config/env.js";
import prisma from "./src/db.js";
import { registerChessGateway } from "./src/socket/chess.gateway.js";

const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

registerChessGateway(io);

httpServer.listen(env.port, () => {
  console.log(`Server running on http://localhost:${env.port}`);
});

process.on("SIGINT", async () => {
  io.close();
  httpServer.close();
  await prisma.$disconnect();
  process.exit(0);
});
