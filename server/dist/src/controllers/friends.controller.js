import prisma from "../db.js";
export async function listFriends(req, res) {
    if (!req.auth) {
        res.status(401).json({ message: "Unauthorized" });
        return;
    }
    const userId = req.auth.userId;
    const friendships = await prisma.friendship.findMany({
        where: {
            status: "ACCEPTED",
            OR: [{ requesterId: userId }, { addresseeId: userId }],
        },
        include: {
            requester: { select: { id: true, username: true } },
            addressee: { select: { id: true, username: true } },
        },
        orderBy: { updatedAt: "desc" },
    });
    const friends = friendships.map((friendship) => {
        const friend = friendship.requesterId === userId ? friendship.addressee : friendship.requester;
        return {
            friendshipId: friendship.id,
            id: friend.id,
            username: friend.username,
        };
    });
    res.json({ friends });
}
export async function listFriendRequests(req, res) {
    if (!req.auth) {
        res.status(401).json({ message: "Unauthorized" });
        return;
    }
    const userId = req.auth.userId;
    const [incoming, outgoing] = await Promise.all([
        prisma.friendship.findMany({
            where: { addresseeId: userId, status: "PENDING" },
            include: {
                requester: { select: { id: true, username: true } },
            },
            orderBy: { createdAt: "desc" },
        }),
        prisma.friendship.findMany({
            where: { requesterId: userId, status: "PENDING" },
            include: {
                addressee: { select: { id: true, username: true } },
            },
            orderBy: { createdAt: "desc" },
        }),
    ]);
    res.json({
        incoming: incoming.map((request) => ({
            requestId: request.id,
            from: request.requester,
            createdAt: request.createdAt,
        })),
        outgoing: outgoing.map((request) => ({
            requestId: request.id,
            to: request.addressee,
            createdAt: request.createdAt,
        })),
    });
}
export async function sendFriendRequest(req, res) {
    if (!req.auth) {
        res.status(401).json({ message: "Unauthorized" });
        return;
    }
    const { username } = req.body;
    if (!username || !username.trim()) {
        res.status(400).json({ message: "username is required" });
        return;
    }
    const normalizedUsername = username.trim().toLowerCase();
    const userId = req.auth.userId;
    const targetUser = await prisma.user.findUnique({
        where: { username: normalizedUsername },
        select: { id: true, username: true },
    });
    if (!targetUser) {
        res.status(404).json({ message: "User not found" });
        return;
    }
    if (targetUser.id === userId) {
        res.status(400).json({ message: "You cannot add yourself" });
        return;
    }
    const existing = await prisma.friendship.findFirst({
        where: {
            OR: [
                { requesterId: userId, addresseeId: targetUser.id },
                { requesterId: targetUser.id, addresseeId: userId },
            ],
        },
    });
    if (existing?.status === "ACCEPTED") {
        res.status(409).json({ message: "You are already friends" });
        return;
    }
    if (existing?.status === "PENDING") {
        if (existing.requesterId === userId) {
            res.status(409).json({ message: "Friend request already sent" });
            return;
        }
        res.status(409).json({ message: "This user already sent you a request. Accept it from incoming requests." });
        return;
    }
    let request;
    if (existing && existing.requesterId === userId && existing.addresseeId === targetUser.id) {
        request = await prisma.friendship.update({
            where: { id: existing.id },
            data: {
                status: "PENDING",
                respondedAt: null,
            },
        });
    }
    else {
        request = await prisma.friendship.create({
            data: {
                requesterId: userId,
                addresseeId: targetUser.id,
                status: "PENDING",
            },
        });
    }
    res.status(201).json({
        request: {
            requestId: request.id,
            to: targetUser,
            status: request.status,
            createdAt: request.createdAt,
        },
    });
}
export async function acceptFriendRequest(req, res) {
    if (!req.auth) {
        res.status(401).json({ message: "Unauthorized" });
        return;
    }
    const requestId = String(req.params.requestId ?? "");
    const userId = req.auth.userId;
    const request = await prisma.friendship.findUnique({
        where: { id: requestId },
        include: {
            requester: { select: { id: true, username: true } },
        },
    });
    if (!request) {
        res.status(404).json({ message: "Friend request not found" });
        return;
    }
    if (request.addresseeId !== userId) {
        res.status(403).json({ message: "Not allowed" });
        return;
    }
    if (request.status !== "PENDING") {
        res.status(400).json({ message: "Friend request is no longer pending" });
        return;
    }
    const updated = await prisma.friendship.update({
        where: { id: request.id },
        data: {
            status: "ACCEPTED",
            respondedAt: new Date(),
        },
    });
    res.json({
        friendship: {
            friendshipId: updated.id,
            friend: request.requester,
            status: updated.status,
            respondedAt: updated.respondedAt,
        },
    });
}
export async function rejectFriendRequest(req, res) {
    if (!req.auth) {
        res.status(401).json({ message: "Unauthorized" });
        return;
    }
    const requestId = String(req.params.requestId ?? "");
    const userId = req.auth.userId;
    const request = await prisma.friendship.findUnique({ where: { id: requestId } });
    if (!request) {
        res.status(404).json({ message: "Friend request not found" });
        return;
    }
    if (request.addresseeId !== userId) {
        res.status(403).json({ message: "Not allowed" });
        return;
    }
    if (request.status !== "PENDING") {
        res.status(400).json({ message: "Friend request is no longer pending" });
        return;
    }
    const updated = await prisma.friendship.update({
        where: { id: request.id },
        data: {
            status: "REJECTED",
            respondedAt: new Date(),
        },
    });
    res.json({
        request: {
            requestId: updated.id,
            status: updated.status,
            respondedAt: updated.respondedAt,
        },
    });
}
//# sourceMappingURL=friends.controller.js.map