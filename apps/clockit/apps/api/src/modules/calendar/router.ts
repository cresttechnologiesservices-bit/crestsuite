import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { requireAuth, AuthedRequest } from "../../middleware/auth";
import { CalendarService } from "./service";
import { parseISO, endOfWeek, addDays, subDays } from "date-fns";
import crypto from "node:crypto";
import env from "../../config";
import {
  googleOAuth,
  outlookOAuth,
  encryptToken,
  isDemoProvider,
  syncExternalEvents,
} from "./oauth";

const r = Router();
r.use(requireAuth);

function resolveRange(view: string, startDate: Date): { start: Date; end: Date } {
  const start = new Date(startDate);
  start.setHours(0, 0, 0, 0);
  let end: Date;
  if (view === "day") {
    end = new Date(start);
    end.setHours(23, 59, 59, 999);
  } else {
    end = endOfWeek(start, { weekStartsOn: 1 });
  }
  return { start, end };
}

// REQ-CAL-B01: Get entries for date range
r.get("/entries", async (req: AuthedRequest, res) => {
  try {
    const view = (req.query.view as string) || "week";
    const startDateStr = req.query.start_date as string;
    const includeExternal = req.query.include_external === "true";
    if (!startDateStr) {
      return res.status(400).json({ error: "start_date is required" });
    }

    const { start: startDate, end: endDate } = resolveRange(view, parseISO(startDateStr));

    const entries = await CalendarService.getEntries(req.userId!, startDate, endDate);

    // REQ-CAL-B15: Include external calendar events (read-only)
    let externalEvents: any[] = [];
    if (includeExternal) {
      externalEvents = await prisma.externalCalendarEvent.findMany({
        where: {
          userId: req.userId!,
          start: { gte: startDate, lte: endDate },
        },
        orderBy: { start: "asc" },
      });
    }

    res.json({ entries, externalEvents });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// REQ-CAL-B02: Get daily totals
r.get("/daily-totals", async (req: AuthedRequest, res) => {
  try {
    const view = (req.query.view as string) || "week";
    const startDateStr = req.query.start_date as string;
    if (!startDateStr) {
      return res.status(400).json({ error: "start_date is required" });
    }

    const { start: startDate, end: endDate } = resolveRange(view, parseISO(startDateStr));

    const totals = await CalendarService.getDailyTotals(req.userId!, startDate, endDate);
    res.json(totals);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// REQ-CAL-B03: Create entry
const CreateEntrySchema = z.object({
  projectId: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  endTime: z.string().regex(/^\d{2}:\d{2}$/),
  description: z.string().optional(),
  billable: z.boolean().optional(),
  tags: z.array(z.string()).optional(),
});
r.post("/entries", async (req: AuthedRequest, res) => {
  try {
    const body = CreateEntrySchema.parse(req.body);
    const date = parseISO(body.date);
    const [startHour, startMin] = body.startTime.split(":").map(Number);
    const [endHour, endMin] = body.endTime.split(":").map(Number);

    const start = new Date(date);
    start.setHours(startHour, startMin, 0, 0);

    const end = new Date(date);
    end.setHours(endHour, endMin, 0, 0);

    const entry = await CalendarService.createEntry(
      req.userId!,
      body.projectId,
      start,
      end,
      body.description,
      body.billable,
      body.tags
    );

    res.status(201).json(entry);
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "validation", details: error.flatten() });
    }
    res.status(500).json({ error: error.message });
  }
});

// REQ-CAL-B04: Update entry (drag/resize/edit)
const UpdateEntrySchema = z.object({
  start: z.string().datetime().optional(),
  end: z.string().datetime().optional(),
  description: z.string().optional(),
  projectId: z.string().optional(),
  billable: z.boolean().optional(),
  tags: z.array(z.string()).optional(),
});
r.patch("/entries/:id", async (req: AuthedRequest, res) => {
  try {
    const body = UpdateEntrySchema.parse(req.body);
    const updates: any = {};
    if (body.start) updates.start = new Date(body.start);
    if (body.end) updates.end = new Date(body.end);
    if (body.description !== undefined) updates.description = body.description;
    if (body.projectId !== undefined) updates.projectId = body.projectId;
    if (body.billable !== undefined) updates.billable = body.billable;
    if (body.tags !== undefined) updates.tags = body.tags;

    const entry = await CalendarService.updateEntry(req.userId!, req.params.id, updates);
    res.json(entry);
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "validation", details: error.flatten() });
    }
    res.status(500).json({ error: error.message });
  }
});

// REQ-CAL-B08: Delete entry (audited)
r.delete("/entries/:id", async (req: AuthedRequest, res) => {
  try {
    await CalendarService.deleteEntry(req.userId!, req.params.id);
    res.json({ deleted: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// REQ-CAL-B06: Get preferences
r.get("/preferences", async (req: AuthedRequest, res) => {
  try {
    const prefs = await CalendarService.getPreferences(req.userId!);
    res.json(prefs);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// REQ-CAL-B09: Update preferences
const UpdatePrefsSchema = z.object({
  viewMode: z.enum(["week", "day"]).optional(),
  zoomLevel: z.number().min(15).max(120).optional(),
  showWorkingDaysOnly: z.boolean().optional(),
});
r.patch("/preferences", async (req: AuthedRequest, res) => {
  try {
    const body = UpdatePrefsSchema.parse(req.body);
    const prefs = await CalendarService.updatePreferences(req.userId!, body);
    res.json(prefs);
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "validation", details: error.flatten() });
    }
    res.status(500).json({ error: error.message });
  }
});

// REQ-CAL-B12: Get integration status
r.get("/integrations/status", async (req: AuthedRequest, res) => {
  try {
    const integrations = await prisma.externalCalendarIntegration.findMany({
      where: { userId: req.userId! },
      select: { provider: true, connectedAt: true, lastSyncAt: true },
    });
    const status: any = { google: false, outlook: false };
    integrations.forEach((i) => {
      status[i.provider] = {
        connected: true,
        connectedAt: i.connectedAt.toISOString(),
        lastSyncAt: i.lastSyncAt?.toISOString(),
      };
    });

    res.json(status);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Demo-mode connect: store stub tokens and seed synced events (REQ-CAL-B10/B11/B15)
async function connectDemoProvider(userId: string, provider: string) {
  await prisma.externalCalendarIntegration.upsert({
    where: { userId_provider: { userId, provider } },
    update: {
      accessToken: encryptToken(`demo-${provider}-access-token`),
      refreshToken: encryptToken(`demo-${provider}-refresh-token`),
      expiresAt: addDays(new Date(), 30),
      connectedAt: new Date(),
    },
    create: {
      userId,
      provider,
      accessToken: encryptToken(`demo-${provider}-access-token`),
      refreshToken: encryptToken(`demo-${provider}-refresh-token`),
      expiresAt: addDays(new Date(), 30),
    },
  });
  await syncExternalEvents(userId, provider, subDays(new Date(), 14), addDays(new Date(), 14));
}

// REQ-CAL-B10: Google Calendar OAuth initiation
r.get("/integrations/google/connect", async (req: AuthedRequest, res) => {
  try {
    if (isDemoProvider("google")) {
      await connectDemoProvider(req.userId!, "google");
      return res.json({ connected: true, demo: true });
    }
    const state = crypto.randomBytes(16).toString("hex");
    // Store state in a cookie for CSRF protection
    res.cookie("oauth_state", state, { httpOnly: true, maxAge: 10 * 60 * 1000 });
    const authUrl = googleOAuth.getAuthUrl(state);
    res.json({ authUrl });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Google OAuth callback
r.get("/integrations/google/callback", async (req: AuthedRequest, res) => {
  try {
    const { code, state } = req.query;
    const storedState = req.cookies?.oauth_state;
    if (!code || !state || state !== storedState) {
      return res.redirect(`${env.APP_URL}/calendar?error=oauth_failed`);
    }

    const tokens = await googleOAuth.exchangeCode(code as string);

    await prisma.externalCalendarIntegration.upsert({
      where: {
        userId_provider: { userId: req.userId!, provider: "google" },
      },
      update: {
        accessToken: encryptToken(tokens.accessToken),
        refreshToken: tokens.refreshToken ? encryptToken(tokens.refreshToken) : undefined,
        expiresAt: tokens.expiresAt,
        connectedAt: new Date(),
      },
      create: {
        userId: req.userId!,
        provider: "google",
        accessToken: encryptToken(tokens.accessToken),
        refreshToken: tokens.refreshToken ? encryptToken(tokens.refreshToken) : null,
        expiresAt: tokens.expiresAt,
      },
    });

    res.clearCookie("oauth_state");
    res.redirect(`${env.APP_URL}/calendar?connected=google`);
  } catch (error: any) {
    console.error("Google OAuth callback error:", error);
    res.redirect(`${env.APP_URL}/calendar?error=oauth_failed`);
  }
});

// REQ-CAL-B11: Outlook Calendar OAuth initiation
r.get("/integrations/outlook/connect", async (req: AuthedRequest, res) => {
  try {
    if (isDemoProvider("outlook")) {
      await connectDemoProvider(req.userId!, "outlook");
      return res.json({ connected: true, demo: true });
    }
    const state = crypto.randomBytes(16).toString("hex");
    res.cookie("oauth_state", state, { httpOnly: true, maxAge: 10 * 60 * 1000 });
    const authUrl = outlookOAuth.getAuthUrl(state);
    res.json({ authUrl });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Outlook OAuth callback
r.get("/integrations/outlook/callback", async (req: AuthedRequest, res) => {
  try {
    const { code, state } = req.query;
    const storedState = req.cookies?.oauth_state;
    if (!code || !state || state !== storedState) {
      return res.redirect(`${env.APP_URL}/calendar?error=oauth_failed`);
    }

    const tokens = await outlookOAuth.exchangeCode(code as string);

    await prisma.externalCalendarIntegration.upsert({
      where: {
        userId_provider: { userId: req.userId!, provider: "outlook" },
      },
      update: {
        accessToken: encryptToken(tokens.accessToken),
        refreshToken: tokens.refreshToken ? encryptToken(tokens.refreshToken) : undefined,
        expiresAt: tokens.expiresAt,
        connectedAt: new Date(),
      },
      create: {
        userId: req.userId!,
        provider: "outlook",
        accessToken: encryptToken(tokens.accessToken),
        refreshToken: tokens.refreshToken ? encryptToken(tokens.refreshToken) : null,
        expiresAt: tokens.expiresAt,
      },
    });

    res.clearCookie("oauth_state");
    res.redirect(`${env.APP_URL}/calendar?connected=outlook`);
  } catch (error: any) {
    console.error("Outlook OAuth callback error:", error);
    res.redirect(`${env.APP_URL}/calendar?error=oauth_failed`);
  }
});

// REQ-CAL-B13: Disconnect integration
r.post("/integrations/:provider/disconnect", async (req: AuthedRequest, res) => {
  try {
    const { provider } = req.params;
    if (!["google", "outlook"].includes(provider)) {
      return res.status(400).json({ error: "Invalid provider" });
    }

    await prisma.externalCalendarIntegration.deleteMany({
      where: { userId: req.userId!, provider },
    });

    // Also remove synced events
    await prisma.externalCalendarEvent.deleteMany({
      where: { userId: req.userId!, provider },
    });

    res.json({ disconnected: true, provider });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// REQ-CAL-B15: Trigger manual sync
r.post("/integrations/:provider/sync", async (req: AuthedRequest, res) => {
  try {
    const { provider } = req.params;
    if (!["google", "outlook"].includes(provider)) {
      return res.status(400).json({ error: "Invalid provider" });
    }
    const startDateStr = req.body.start_date;
    const endDateStr = req.body.end_date;
    if (!startDateStr || !endDateStr) {
      return res.status(400).json({ error: "start_date and end_date required" });
    }

    const count = await syncExternalEvents(
      req.userId!,
      provider,
      parseISO(startDateStr),
      parseISO(endDateStr)
    );

    res.json({ synced: count });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// REQ-CAL-B07: Get overlapping entries for layout
r.get("/layout/:date", async (req: AuthedRequest, res) => {
  try {
    const date = parseISO(req.params.date);
    const layout = await CalendarService.getOverlappingEntries(req.userId!, date);
    res.json(layout);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default r;
