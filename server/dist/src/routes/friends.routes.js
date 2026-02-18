import { Router } from "express";
import { acceptFriendRequest, listFriendRequests, listFriends, rejectFriendRequest, sendFriendRequest, } from "../controllers/friends.controller.js";
import { authMiddleware } from "../middleware/auth.middleware.js";
const friendsRouter = Router();
friendsRouter.use(authMiddleware);
friendsRouter.get("/", listFriends);
friendsRouter.get("/requests", listFriendRequests);
friendsRouter.post("/request", sendFriendRequest);
friendsRouter.post("/request/:requestId/accept", acceptFriendRequest);
friendsRouter.post("/request/:requestId/reject", rejectFriendRequest);
export default friendsRouter;
//# sourceMappingURL=friends.routes.js.map