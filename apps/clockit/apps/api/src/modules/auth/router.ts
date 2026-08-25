import { Router, RequestHandler } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { z } from "zod";
import env from "../../config";
import { prisma } from "../../lib/prisma";
import { generateOtp, hashOtp, verifyOtp } from "../../lib/otp";
import { sendOtpEmail } from "../../lib/mail";
import { TurnstileService } from "../turnstile/service";
import { requireAuth, AuthedRequest } from "../../middleware/auth";
import { authLimiter, otpLimiter } from "../../middleware/rateLimit";
import { NotificationService, DEFAULT_NOTIFICATION_PREFS } from "../notifications/service";

const r = Router();

// Forward async errors (incl. ZodError) to the error handler middleware
const wrap = (fn: RequestHandler): RequestHandler => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

const SignupSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1),
  // REQ-SU-B06: minimum password strength policy
  password: z.string().min(8),
});

const clientIp = (req: AuthedRequest) =>
  (req.headers["x-forwarded-for"] as string)?.split(",")[0] || req.ip || "unknown";

// REQ-SU-B01: check email
r.post("/signup/check-email", wrap(async (req, res) => {
  const { email } = z.object({ email: z.string().email() }).parse(req.body);
  const exists = await prisma.user.findUnique({ where: { email } });
  res.json({ exists: !!exists });
}));

// REQ-SU-B02: email ownership verification via OTP before account activation
r.post("/signup/verify", wrap(async (req, res) => {
  const { email, code } = z
    .object({ email: z.string().email(), code: z.string().length(6) })
    .parse(req.body);
  const otp = await prisma.otp.findFirst({
    where: { email, used: false },
    orderBy: { createdAt: "desc" },
  });
  if (!otp) return res.status(400).json({ error: "no_otp" });
  if (otp.expiresAt < new Date()) return res.status(400).json({ error: "expired" });
  const ok = await verifyOtp(code, otp.codeHash);
  if (!ok) {
    await prisma.otp.update({ where: { id: otp.id }, data: { attempts: { increment: 1 } } });
    return res.status(400).json({ error: "invalid_code" });
  }
  await prisma.otp.update({ where: { id: otp.id }, data: { used: true } });
  res.json({ verified: true });
}));

// REQ-SU-B03, B05, B07, B08: create account (rate limited per IP)
r.post("/signup", authLimiter, wrap(async (req, res) => {
  const { email, name, password } = SignupSchema.parse(req.body);
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return res.status(409).json({ error: "email_taken" });
  const passwordHash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({
    // REQ-SU-B05: default role/status; REQ-ACC-B08: default notification prefs
    data: {
      email,
      name,
      passwordHash,
      status: "active",
      role: "MEMBER",
      emailPrefs: DEFAULT_NOTIFICATION_PREFS,
    },
  });
  // REQ-SU-B07: asynchronous welcome/confirmation email
  setImmediate(() => {
    NotificationService.sendNotification(
      user.id,
      "onboarding",
      "Welcome to ClockIT",
      `Hi ${name}, your ClockIT account is ready. Start tracking your time!`
    ).catch((e) => console.error("Failed to send welcome email", e));
  });
  res.status(201).json({ id: user.id, email: user.email });
}));

// REQ-SU-B06: set/update password with minimum strength policy
r.post("/signup/set-password", requireAuth, wrap(async (req: AuthedRequest, res) => {
  const { password } = z.object({ password: z.string().min(8) }).parse(req.body);
  const passwordHash = await bcrypt.hash(password, 10);
  await prisma.user.update({ where: { id: req.userId! }, data: { passwordHash } });
  res.json({ ok: true });
}));

// REQ-LI-B02: request OTP (with Turnstile verification)
const OtpRateMap = new Map<string, number>();

async function issueOtp(email: string, res: any): Promise<boolean> {
  const now = Date.now();
  const last = OtpRateMap.get(email) || 0;
  // REQ-LI-B07: Rate limit 25 seconds between OTP requests per email
  if (now - last < 25_000) {
    res.status(429).json({ error: "too_soon", retryIn: Math.ceil((25_000 - (now - last)) / 1000) });
    return false;
  }
  OtpRateMap.set(email, now);
  const code = generateOtp();
  // REQ-LI-B03: hashed OTP with <= 10 minute expiry
  const expiresAt = new Date(now + 10 * 60_000);
  // REQ-LI-B04: Invalidate previous unused OTPs
  await prisma.otp.updateMany({ where: { email, used: false }, data: { used: true } });
  await prisma.otp.create({
    data: { email, codeHash: await hashOtp(code), expiresAt },
  });
  // Dispatched asynchronously (REQ-LI-B02)
  sendOtpEmail(email, code).catch((e) => console.error("Failed to send OTP email", e));
  return true;
}

r.post("/email/request-otp", otpLimiter, wrap(async (req, res) => {
  const { email, turnstileToken } = z.object({
    email: z.string().email(),
    turnstileToken: z.string().min(1),
  }).parse(req.body);
  // REQ-LI-B01: Verify Turnstile token
  const ip = clientIp(req);
  const turnstileOk = await TurnstileService.verify(turnstileToken, ip, email);
  if (!turnstileOk) {
    return res.status(403).json({ error: "captcha_failed" });
  }
  // REQ-LI-B14: Server-side email validation
  if (!/^\S+@\S+\.\S+$/.test(email)) {
    return res.status(400).json({ error: "invalid_email" });
  }
  const issued = await issueOtp(email, res);
  if (!issued) return;
  res.json({ ok: true });
}));

// REQ-LI-B08: resend OTP, subject to the same rate limiting
r.post("/email/resend-otp", otpLimiter, wrap(async (req, res) => {
  const { email } = z.object({ email: z.string().email() }).parse(req.body);
  if (!/^\S+@\S+\.\S+$/.test(email)) {
    return res.status(400).json({ error: "invalid_email" });
  }
  const issued = await issueOtp(email, res);
  if (!issued) return;
  res.json({ ok: true });
}));

// REQ-LI-B05, B06: verify OTP
r.post("/email/verify-otp", wrap(async (req, res) => {
  const { email, code } = z
    .object({ email: z.string().email(), code: z.string().length(6) })
    .parse(req.body);
  const otp = await prisma.otp.findFirst({
    where: { email, used: false },
    orderBy: { createdAt: "desc" },
  });
  if (!otp) return res.status(400).json({ error: "no_otp" });
  if (otp.expiresAt < new Date()) return res.status(400).json({ error: "expired" });
  // REQ-LI-B06: Max 5 attempts
  if (otp.attempts >= 5) {
    await prisma.otp.update({ where: { id: otp.id }, data: { used: true } });
    return res.status(400).json({ error: "max_attempts" });
  }
  const ok = await verifyOtp(code, otp.codeHash);
  if (!ok) {
    await prisma.otp.update({ where: { id: otp.id }, data: { attempts: { increment: 1 } } });
    // REQ-LI-B13: Log failed attempt
    await prisma.auditLog.create({
      data: {
        action: "OTP_FAILED",
        metadata: { email, ip: clientIp(req), reason: "invalid_code", attempts: otp.attempts + 1 },
      },
    });
    return res.status(400).json({ error: "invalid_code" });
  }
  await prisma.otp.update({ where: { id: otp.id }, data: { used: true } });
  let user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    user = await prisma.user.create({
      data: {
        email,
        name: email.split("@")[0],
        status: "active",
        // REQ-ACC-B08: default notification configuration
        emailPrefs: DEFAULT_NOTIFICATION_PREFS,
      },
    });
  } else if (user.status === "invited") {
    user = await prisma.user.update({
      where: { id: user.id },
      data: { status: "active" },
    });
  }
  if (user.status !== "active") {
    return res.status(403).json({ error: "account_inactive" });
  }
  // REQ-LI-B12: Issue signed session token
  const token = jwt.sign({ sub: user.id }, env.JWT_SECRET, { expiresIn: "7d" });
  res.cookie("session", token, { httpOnly: true, sameSite: "lax", maxAge: 7 * 86400_000 });
  res.json({ token, user: { id: user.id, email: user.email, name: user.name } });
}));

// B3: email + password login (the app previously only offered the OTP flow,
// so seeded users with a passwordHash had no way to sign in with it).
r.post("/login", authLimiter, wrap(async (req, res) => {
  const { email, password } = z
    .object({ email: z.string().email(), password: z.string().min(1) })
    .parse(req.body);
  const user = await prisma.user.findUnique({ where: { email } });
  const fail = async (reason: string) => {
    await prisma.auditLog.create({
      data: {
        action: "LOGIN_FAILED",
        metadata: { email, ip: clientIp(req), reason },
      },
    });
    // Generic message: do not reveal whether the account exists
    return res.status(401).json({ error: "invalid_credentials" });
  };
  if (!user || !user.passwordHash) return fail("unknown_user_or_no_password");
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return fail("wrong_password");
  if (user.status !== "active") {
    return res.status(403).json({ error: "account_inactive" });
  }
  // Same session semantics as verify-otp above
  const token = jwt.sign({ sub: user.id }, env.JWT_SECRET, { expiresIn: "7d" });
  res.cookie("session", token, { httpOnly: true, sameSite: "lax", maxAge: 7 * 86400_000 });
  res.json({ token, user: { id: user.id, email: user.email, name: user.name } });
}));

// CrestSuite portal single-sign-on: exchange a short-lived portal-signed token
// for a regular session cookie. Auto-provisions unknown users, mirroring the
// verify-otp behaviour above.
r.post("/sso", wrap(async (req, res) => {
  const { token } = z.object({ token: z.string().min(1) }).parse(req.body);
  let claims: { email: string; name?: string; role?: string };
  try {
    claims = jwt.verify(token, env.PORTAL_SECRET) as typeof claims;
  } catch {
    return res.status(401).json({ error: "invalid_sso_token" });
  }
  const roleMap: Record<string, "OWNER" | "ADMIN" | "MANAGER"> = {
    owner: "OWNER",
    admin: "ADMIN",
    manager: "MANAGER",
  };
  const mappedRole = roleMap[claims.role ?? ""] ?? "MEMBER";
  let user = await prisma.user.findUnique({ where: { email: claims.email } });
  if (user) {
    // The portal directory is the source of truth for name and role — sync on
    // every SSO so directory edits propagate even if the live push was missed
    // (ClockIT restarting, for example).
    const drift: Record<string, unknown> = {};
    if (user.role !== mappedRole) drift.role = mappedRole;
    if (claims.name && claims.name !== user.name) drift.name = claims.name;
    if (Object.keys(drift).length) {
      user = await prisma.user.update({ where: { id: user.id }, data: drift });
    }
  }
  if (!user) {
    user = await prisma.user.create({
      data: {
        email: claims.email,
        name: claims.name || claims.email.split("@")[0],
        status: "active",
        role: mappedRole,
        emailPrefs: DEFAULT_NOTIFICATION_PREFS,
      },
    });
  }
  if (user.status !== "active") {
    return res.status(403).json({ error: "account_inactive" });
  }
  const session = jwt.sign({ sub: user.id }, env.JWT_SECRET, { expiresIn: "7d" });
  res.cookie("session", session, { httpOnly: true, sameSite: "lax", maxAge: 7 * 86400_000 });
  res.json({ token: session, user: { id: user.id, email: user.email, name: user.name } });
}));

// REQ-ACC-B02: logout
r.post("/logout", wrap(async (_req, res) => {
  res.clearCookie("session");
  res.json({ ok: true });
}));

// REQ-ACC-B01: me (also served at /api/users/me)
r.get("/me", requireAuth, wrap(async (req: AuthedRequest, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.userId! } });
  if (!user) return res.status(404).json({ error: "not_found" });
  const { passwordHash, ...safe } = user;
  res.json(safe);
}));

export default r;
