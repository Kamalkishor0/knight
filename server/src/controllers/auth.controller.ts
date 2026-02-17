import bcrypt from "bcrypt";
import type { Request, Response } from "express";
import prisma from "../db.js";
import type { AuthenticatedRequest } from "../types/auth.js";
import { signToken } from "../utils/jwt.js";

export async function register(req: Request, res: Response) {
  const { username, email, password } = req.body as {
    username?: string;
    email?: string;
    password?: string;
  };

  if (!username || !email || !password) {
    res.status(400).json({ message: "username, email and password are required" });
    return;
  }

  if (password.length < 8) {
    res.status(400).json({ message: "Password must be at least 8 characters" });
    return;
  }

  const normalizedUsername = username.trim().toLowerCase();
  const normalizedEmail = email.toLowerCase().trim();

  if (!normalizedUsername) {
    res.status(400).json({ message: "username cannot be empty" });
    return;
  }

  const existingUsername = await prisma.user.findUnique({
    where: { username: normalizedUsername },
  });

  if (existingUsername) {
    res.status(409).json({ message: "Username already in use" });
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

  const user = await prisma.user.create({
    data: {
      username: normalizedUsername,
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
    res.status(400).json({ message: "email or username is required" });
    return;
  }
  let user = null;
  if(username){
    user = await prisma.user.findUnique({
      where: { username },
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
