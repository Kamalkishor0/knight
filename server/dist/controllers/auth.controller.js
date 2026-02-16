import bcrypt from "bcrypt";
import prisma from "../db.js";
import { signToken } from "../utils/jwt.js";
export async function register(req, res) {
    const { name, email, password } = req.body;
    if (!name || !email || !password) {
        res.status(400).json({ message: "name, email and password are required" });
        return;
    }
    if (password.length < 8) {
        res.status(400).json({ message: "Password must be at least 8 characters" });
        return;
    }
    const normalizedEmail = email.toLowerCase().trim();
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
            name: name.trim(),
            email: normalizedEmail,
            password: passwordHash,
        },
        select: {
            id: true,
            name: true,
            email: true,
            createdAt: true,
        },
    });
    const token = signToken({ userId: user.id, email: user.email });
    res.status(201).json({ token, user });
}
export async function login(req, res) {
    const { email, password } = req.body;
    if (!email || !password) {
        res.status(400).json({ message: "email and password are required" });
        return;
    }
    const normalizedEmail = email.toLowerCase().trim();
    const user = await prisma.user.findUnique({
        where: { email: normalizedEmail },
    });
    if (!user) {
        res.status(401).json({ message: "Invalid email or password" });
        return;
    }
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
        res.status(401).json({ message: "Invalid email or password" });
        return;
    }
    const token = signToken({ userId: user.id, email: user.email });
    res.json({
        token,
        user: {
            id: user.id,
            name: user.name,
            email: user.email,
            createdAt: user.createdAt,
        },
    });
}
export async function me(req, res) {
    if (!req.auth) {
        res.status(401).json({ message: "Unauthorized" });
        return;
    }
    const user = await prisma.user.findUnique({
        where: { id: req.auth.userId },
        select: {
            id: true,
            name: true,
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
//# sourceMappingURL=auth.controller.js.map