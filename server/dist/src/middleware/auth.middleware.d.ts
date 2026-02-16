import type { NextFunction, Response } from "express";
import type { AuthenticatedRequest } from "../types/auth.js";
export declare function authMiddleware(req: AuthenticatedRequest, res: Response, next: NextFunction): void;
