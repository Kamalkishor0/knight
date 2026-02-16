import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, "../../.env") });
const env = {
    port: Number(process.env.PORT ?? 3000),
    databaseUrl: process.env.DATABASE_URL ?? "",
    jwtSecret: process.env.JWT_SECRET ?? "",
};
if (!env.databaseUrl) {
    throw new Error("Missing DATABASE_URL in environment variables.");
}
if (!env.jwtSecret) {
    throw new Error("Missing JWT_SECRET in environment variables.");
}
export default env;
//# sourceMappingURL=env.js.map