import { Request, Response, NextFunction } from "express";
import { ZodError } from "zod";

export function errorHandler(err: any, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) return res.status(400).json({ error: "validation", details: err.flatten() });
  console.error(err);
  res.status(500).json({ error: "internal_error" });
}