import type { Request, Response } from "express";
import type { AuthenticatedRequest } from "../types/auth.js";
export declare function register(req: Request, res: Response): Promise<void>;
export declare function login(req: Request, res: Response): Promise<void>;
export declare function me(req: AuthenticatedRequest, res: Response): Promise<void>;
