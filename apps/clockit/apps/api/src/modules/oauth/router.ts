import { Router } from "express";
import { z } from "zod";
import { OAuthService } from "./service";

const r = Router();

/**
 * REQ-LI-B09: Google OAuth endpoint
 */
r.post("/google", async (req, res) => {
  try {
    const { idToken } = z.object({ idToken: z.string().min(1) }).parse(req.body);
    const userInfo = await OAuthService.verifyGoogleToken(idToken);
    const { token, user } = await OAuthService.provisionUser(userInfo);
    res.cookie("session", token, {
      httpOnly: true,
      sameSite: "lax",
      maxAge: 7 * 86400_000,
    });
    res.json({
      token,
      user: { id: user.id, email: user.email, name: user.name },
    });
  } catch (error: any) {
    res.status(401).json({ error: error.message });
  }
});

/**
 * REQ-LI-B10: Microsoft OAuth endpoint
 */
r.post("/microsoft", async (req, res) => {
  try {
    const { idToken } = z.object({ idToken: z.string().min(1) }).parse(req.body);
    const userInfo = await OAuthService.verifyMicrosoftToken(idToken);
    const { token, user } = await OAuthService.provisionUser(userInfo);
    res.cookie("session", token, {
      httpOnly: true,
      sameSite: "lax",
      maxAge: 7 * 86400_000,
    });
    res.json({
      token,
      user: { id: user.id, email: user.email, name: user.name },
    });
  } catch (error: any) {
    res.status(401).json({ error: error.message });
  }
});

/**
 * REQ-LI-B11: Apple OAuth endpoint
 */
r.post("/apple", async (req, res) => {
  try {
    const { identityToken } = z.object({ identityToken: z.string().min(1) }).parse(req.body);
    const userInfo = await OAuthService.verifyAppleToken(identityToken);
    const { token, user } = await OAuthService.provisionUser(userInfo);
    res.cookie("session", token, {
      httpOnly: true,
      sameSite: "lax",
      maxAge: 7 * 86400_000,
    });
    res.json({
      token,
      user: { id: user.id, email: user.email, name: user.name },
    });
  } catch (error: any) {
    res.status(401).json({ error: error.message });
  }
});

export default r;
