import bcrypt from "bcrypt";
import { randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import prisma from "../db.js";
import type { AuthenticatedRequest } from "../types/auth.js";
import env from "../config/env.js";
import { signToken } from "../utils/jwt.js";

function normalizeUsername(username: string) {
  return username.trim().toLowerCase();
}

function createTemporaryUsername(email: string) {
  const localPart = email.split("@")[0]?.replace(/[^a-z0-9]/gi, "").toLowerCase() || "user";
  return `${localPart}-${randomUUID().slice(0, 8)}`;
}

async function getGoogleUserFromSupabase(accessToken: string) {
  if (!env.supabaseUrl || !env.supabaseAnonKey) {
    return { error: "Missing Supabase configuration on server." } as const;
  }

  let response: globalThis.Response;
  try {
    response = await fetch(`${env.supabaseUrl}/auth/v1/user`, {
      method: "GET",
      headers: {
        apikey: env.supabaseAnonKey,
        Authorization: `Bearer ${accessToken}`,
      },
      signal: AbortSignal.timeout(12000),
    });
  } catch {
    return { error: "Could not verify Google session with Supabase." } as const;
  }

  const data = await response.json().catch(() => null) as { email?: string; app_metadata?: { provider?: string } } | null;

  if (!response.ok || !data) {
    return { error: "Invalid Google session." } as const;
  }

  if (data.app_metadata?.provider !== "google") {
    return { error: "Unsupported OAuth provider." } as const;
  }

  if (!data.email) {
    return { error: "Google account email is required." } as const;
  }

  return { email: data.email.toLowerCase().trim() } as const;
}

export async function register(req: Request, res: Response) {
  const { email, password } = req.body as {
    email?: string;
    password?: string;
  };

  if (!email || !password) {
    res.status(400).json({ message: "email and password are required" });
    return;
  }

  if (password.length < 8) {
    res.status(400).json({ message: "Password must be at least 8 characters" });
    return;
  }

  const normalizedEmail = email.toLowerCase().trim();

  if (!normalizedEmail) {
    res.status(400).json({ message: "email is required" });
    return;
  }

  const existingUser = await prisma.user.findUnique({
    where: { email: normalizedEmail },
  });

  if (existingUser) {
    res.status(409).json({ message: "Email already in use" });
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const username = createTemporaryUsername(normalizedEmail);

  const user = await prisma.user.create({
    data: {
      username,
      email: normalizedEmail,
      password: passwordHash,
    },
    select: {
      id: true,
      username: true,
      email: true,
      createdAt: true,
    },
  });

  const token = signToken({username: user.username, userId: user.id, email: user.email });
  res.status(201).json({ token, user });
}

export async function setUsername(req: AuthenticatedRequest, res: Response) {
  if (!req.auth) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }

  const { username } = req.body as {
    username?: string;
  };

  if (!username || !username.trim()) {
    res.status(400).json({ message: "username is required" });
    return;
  }

  const normalizedUsername = normalizeUsername(username);

  if (normalizedUsername.length < 3) {
    res.status(400).json({ message: "username must be at least 3 characters" });
    return;
  }

  const currentUser = await prisma.user.findUnique({
    where: { id: req.auth.userId },
  });

  if (!currentUser) {
    res.status(404).json({ message: "User not found" });
    return;
  }

  const existingUsername = await prisma.user.findUnique({
    where: { username: normalizedUsername },
  });

  if (existingUsername && existingUsername.id !== currentUser.id) {
    res.status(409).json({ message: "Username already in use" });
    return;
  }

  const user = await prisma.user.update({
    where: { id: currentUser.id },
    data: {
      username: normalizedUsername,
    },
    select: {
      id: true,
      username: true,
      email: true,
      createdAt: true,
    },
  });

  const token = signToken({ username: user.username, userId: user.id, email: user.email });
  res.json({ token, user });
}

export async function loginWithGoogle(req: Request, res: Response) {
  const { accessToken } = req.body as {
    accessToken?: string;
  };

  if (!accessToken) {
    res.status(400).json({ message: "accessToken is required" });
    return;
  }

  const supabaseUser = await getGoogleUserFromSupabase(accessToken);

  if ("error" in supabaseUser) {
    res.status(401).json({ message: supabaseUser.error });
    return;
  }

  let user = await prisma.user.findUnique({
    where: { email: supabaseUser.email },
    select: {
      id: true,
      username: true,
      email: true,
      createdAt: true,
    },
  });

  if (!user) {
    const placeholderPassword = await bcrypt.hash(randomUUID(), 12);
    user = await prisma.user.create({
      data: {
        email: supabaseUser.email,
        username: createTemporaryUsername(supabaseUser.email),
        password: placeholderPassword,
      },
      select: {
        id: true,
        username: true,
        email: true,
        createdAt: true,
      },
    });
  }

  const token = signToken({ username: user.username, userId: user.id, email: user.email });
  res.json({ token, user });
}

export async function login(req: Request, res: Response) {
  const { username, email, password } = req.body as {
    username?: string;
    email?: string;
    password?: string;
  };

  if (!password) {
    res.status(400).json({ message: "email and password are required" });
    return;
  }
  if(!email && !username) {
    res.status(400).json({ message: "email and username is required" });
    return;
  }
  let user = null;
  if(username){
    user = await prisma.user.findUnique({
      where: { username: username.trim().toLowerCase() },
    });
  } else {
      if (!email) {
        res.status(400).json({ message: "enter email or username" });
        return;
      }

      const normalizedEmail = email.toLowerCase().trim();

      user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
  });

  }
  
  if (!user) {
    res.status(401).json({ message: "Invalid email or password" });
    return;
  }

  const isPasswordValid = await bcrypt.compare(password, user.password);

  if (!isPasswordValid) {
    res.status(401).json({ message: "Invalid email or password" });
    return;
  }

  const token = signToken({username: user.username, userId: user.id, email: user.email });

  res.json({
    token,
    user: {
      id: user.id,
      username: user.username,
      email: user.email,
      createdAt: user.createdAt,
    },
  });
}

export async function me(req: AuthenticatedRequest, res: Response) {
  if (!req.auth) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }

  const user = await prisma.user.findUnique({
    where: { id: req.auth.userId },
    select: {
      id: true,
      username: true,
      email: true,
      createdAt: true,
    },
  });

  if (!user) {
    res.status(404).json({ message: "User not found" });
    return;
  }

  res.json({ user });
}
