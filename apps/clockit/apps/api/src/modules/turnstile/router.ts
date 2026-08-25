import { Router } from "express";
import { z } from "zod";
import { TurnstileService } from "./service";

const r = Router();

// REQ-LI-B01: Verify Turnstile token
r.post("/verify", async (req, res) => {
  try {
    const { token } = z.object({ token: z.string().min(1) }).parse(req.body);
    const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0] || req.ip || "unknown";
    const email = req.body.email;
    const success = await TurnstileService.verify(token, ip, email);
    res.json({ success });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

export default r;
