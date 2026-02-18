import type { Response } from "express";
import type { AuthenticatedRequest } from "../types/auth.js";
export declare function listFriends(req: AuthenticatedRequest, res: Response): Promise<void>;
export declare function listFriendRequests(req: AuthenticatedRequest, res: Response): Promise<void>;
export declare function sendFriendRequest(req: AuthenticatedRequest, res: Response): Promise<void>;
export declare function acceptFriendRequest(req: AuthenticatedRequest, res: Response): Promise<void>;
export declare function rejectFriendRequest(req: AuthenticatedRequest, res: Response): Promise<void>;
