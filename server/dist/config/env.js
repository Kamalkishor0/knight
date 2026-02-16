import "dotenv/config";
const env = {
    port: Number(process.env.PORT ?? 4000),
    jwtSecret: process.env.JWT_SECRET ?? "",
};
if (!env.jwtSecret) {
    throw new Error("Missing JWT_SECRET in environment variables.");
}
export default env;
//# sourceMappingURL=env.js.map