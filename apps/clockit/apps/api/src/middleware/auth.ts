import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import env from "../config";
import { prisma } from "../lib/prisma";

export interface AuthedRequest extends Request {
  userId?: string;
}

export async function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const token = req.cookies?.session || req.headers.authorization?.replace("Bearer ", "");
  if (!token) return res.status(401).json({ error: "unauthorized" });
  try {
    const payload = jwt.verify(token, env.JWT_SECRET) as { sub: string };
    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || user.status !== "active") return res.status(401).json({ error: "unauthorized" });
    req.userId = user.id;
    next();
  } catch {
    res.status(401).json({ error: "invalid_token" });
  }
}