import app from "./src/app.js";
import env from "./src/config/env.js";
import prisma from "./src/db.js";

app.listen(env.port, () => {
  console.log(`Auth server running on http://localhost:${env.port}`);
});

process.on("SIGINT", async () => {
  await prisma.$disconnect();
  process.exit(0);
});
