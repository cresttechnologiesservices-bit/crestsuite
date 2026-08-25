import crypto from "node:crypto";
import { addDays, setHours, setMinutes } from "date-fns";
import env from "../../config";
import { prisma } from "../../lib/prisma";

// Simple AES encryption for tokens at rest (REQ-CAL-B14)
const ENCRYPTION_KEY = crypto.createHash("sha256").update(env.JWT_SECRET).digest();
const IV_LENGTH = 16;

export function encryptToken(token: string): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv("aes-256-cbc", ENCRYPTION_KEY, iv);
  let encrypted = cipher.update(token, "utf8", "hex");
  encrypted += cipher.final("hex");
  return iv.toString("hex") + ":" + encrypted;
}

export function decryptToken(encrypted: string): string {
  const [ivHex, encryptedHex] = encrypted.split(":");
  const iv = Buffer.from(ivHex, "hex");
  const decipher = crypto.createDecipheriv("aes-256-cbc", ENCRYPTION_KEY, iv);
  let decrypted = decipher.update(encryptedHex, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

// Demo mode: no real OAuth app configured, so connect/sync are stubbed.
export function isDemoProvider(provider: string): boolean {
  if (provider === "google") return !env.GOOGLE_CLIENT_ID;
  if (provider === "outlook") return !env.MICROSOFT_CLIENT_ID;
  return true;
}

/**
 * REQ-CAL-B10: Google Calendar OAuth
 */
export const googleOAuth = {
  getAuthUrl(state: string): string {
    const params = new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      redirect_uri: `${env.API_URL}/api/calendar/integrations/google/callback`,
      response_type: "code",
      scope: "https://www.googleapis.com/auth/calendar.readonly",
      access_type: "offline",
      prompt: "consent",
      state,
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
  },
  async exchangeCode(code: string): Promise<{ accessToken: string; refreshToken: string; expiresAt: Date }> {
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
        redirect_uri: `${env.API_URL}/api/calendar/integrations/google/callback`,
        grant_type: "authorization_code",
      }),
    });
    const data: any = await response.json();
    if (!response.ok) throw new Error(data.error || "Google OAuth failed");

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: new Date(Date.now() + data.expires_in * 1000),
    };
  },
  async refreshAccessToken(refreshToken: string): Promise<{ accessToken: string; expiresAt: Date }> {
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
    });
    const data: any = await response.json();
    if (!response.ok) throw new Error("Failed to refresh Google token");

    return {
      accessToken: data.access_token,
      expiresAt: new Date(Date.now() + data.expires_in * 1000),
    };
  },
  /**
   * REQ-CAL-B15: Fetch events from Google Calendar
   */
  async fetchEvents(accessToken: string, timeMin: Date, timeMax: Date): Promise<any[]> {
    const params = new URLSearchParams({
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      singleEvents: "true",
      orderBy: "startTime",
      maxResults: "250",
    });
    const response = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!response.ok) throw new Error("Failed to fetch Google Calendar events");

    const data: any = await response.json();
    return (data.items || []).map((event: any) => ({
      externalId: event.id,
      title: event.summary || "Untitled",
      description: event.description,
      start: new Date(event.start.dateTime || event.start.date),
      end: new Date(event.end.dateTime || event.end.date),
      allDay: !event.start.dateTime,
      color: null,
    }));
  },
};

/**
 * REQ-CAL-B11: Outlook Calendar OAuth
 */
export const outlookOAuth = {
  getAuthUrl(state: string): string {
    const params = new URLSearchParams({
      client_id: env.MICROSOFT_CLIENT_ID,
      response_type: "code",
      redirect_uri: `${env.API_URL}/api/calendar/integrations/outlook/callback`,
      scope: "Calendars.Read offline_access",
      state,
    });
    return `https://login.microsoftonline.com/${env.MICROSOFT_TENANT}/oauth2/v2.0/authorize?${params}`;
  },
  async exchangeCode(code: string): Promise<{ accessToken: string; refreshToken: string; expiresAt: Date }> {
    const response = await fetch(`https://login.microsoftonline.com/${env.MICROSOFT_TENANT}/oauth2/v2.0/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: env.MICROSOFT_CLIENT_ID,
        client_secret: env.MICROSOFT_CLIENT_SECRET,
        redirect_uri: `${env.API_URL}/api/calendar/integrations/outlook/callback`,
        grant_type: "authorization_code",
        scope: "Calendars.Read offline_access",
      }),
    });
    const data: any = await response.json();
    if (!response.ok) throw new Error(data.error || "Outlook OAuth failed");

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: new Date(Date.now() + data.expires_in * 1000),
    };
  },
  async refreshAccessToken(refreshToken: string): Promise<{ accessToken: string; expiresAt: Date }> {
    const response = await fetch(`https://login.microsoftonline.com/${env.MICROSOFT_TENANT}/oauth2/v2.0/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: env.MICROSOFT_CLIENT_ID,
        client_secret: env.MICROSOFT_CLIENT_SECRET,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
        scope: "Calendars.Read offline_access",
      }),
    });
    const data: any = await response.json();
    if (!response.ok) throw new Error("Failed to refresh Outlook token");

    return {
      accessToken: data.access_token,
      expiresAt: new Date(Date.now() + data.expires_in * 1000),
    };
  },
  /**
   * REQ-CAL-B15: Fetch events from Outlook Calendar
   */
  async fetchEvents(accessToken: string, timeMin: Date, timeMax: Date): Promise<any[]> {
    const params = new URLSearchParams({
      startDateTime: timeMin.toISOString(),
      endDateTime: timeMax.toISOString(),
      $orderby: "start/dateTime",
      $top: "250",
    });
    const response = await fetch(`https://graph.microsoft.com/v1.0/me/calendarView?${params}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!response.ok) throw new Error("Failed to fetch Outlook Calendar events");

    const data: any = await response.json();
    return (data.value || []).map((event: any) => ({
      externalId: event.id,
      title: event.subject || "Untitled",
      description: event.bodyPreview,
      start: new Date(`${event.start.dateTime}Z`),
      end: new Date(`${event.end.dateTime}Z`),
      allDay: event.isAllDay,
      color: null,
    }));
  },
};

/**
 * REQ-CAL-B14: Refresh tokens before expiry
 */
export async function refreshTokensIfNeeded(userId: string) {
  const integrations = await prisma.externalCalendarIntegration.findMany({
    where: { userId },
  });
  for (const integration of integrations) {
    if (isDemoProvider(integration.provider)) continue;
    // Refresh if token expires within 5 minutes
    if (integration.expiresAt && integration.expiresAt.getTime() - Date.now() < 5 * 60 * 1000) {
      if (!integration.refreshToken) continue;
      const decryptedRefresh = decryptToken(integration.refreshToken);

      try {
        let newTokens: { accessToken: string; expiresAt: Date };

        if (integration.provider === "google") {
          newTokens = await googleOAuth.refreshAccessToken(decryptedRefresh);
        } else if (integration.provider === "outlook") {
          newTokens = await outlookOAuth.refreshAccessToken(decryptedRefresh);
        } else {
          continue;
        }

        await prisma.externalCalendarIntegration.update({
          where: { id: integration.id },
          data: {
            accessToken: encryptToken(newTokens.accessToken),
            expiresAt: newTokens.expiresAt,
          },
        });
      } catch (error) {
        console.error(`Failed to refresh ${integration.provider} token for user ${userId}`, error);
      }
    }
  }
}

/**
 * Demo-mode stand-in for a provider API: deterministic sample events
 * within the requested range so the calendar has read-only entries to show.
 */
function generateStubEvents(provider: string, timeMin: Date, timeMax: Date) {
  const events: any[] = [];
  const templates =
    provider === "google"
      ? [
          { title: "Team standup", startHour: 9, startMin: 30, durationMin: 30 },
          { title: "1:1 with manager", startHour: 14, startMin: 0, durationMin: 45 },
        ]
      : [
          { title: "Sprint planning", startHour: 11, startMin: 0, durationMin: 60 },
          { title: "Client sync", startHour: 16, startMin: 0, durationMin: 30 },
        ];

  let day = new Date(timeMin);
  day.setHours(0, 0, 0, 0);
  while (day <= timeMax) {
    const weekday = day.getDay();
    if (weekday !== 0 && weekday !== 6) {
      // Spread templates across weekdays so not every day is identical
      const template = templates[(weekday + (provider === "google" ? 0 : 1)) % templates.length];
      const start = setMinutes(setHours(new Date(day), template.startHour), template.startMin);
      const end = new Date(start.getTime() + template.durationMin * 60000);
      if (start >= timeMin && end <= timeMax) {
        events.push({
          externalId: `${provider}-stub-${start.toISOString().slice(0, 10)}`,
          title: template.title,
          description: `Synced from ${provider === "google" ? "Google" : "Outlook"} Calendar (demo)`,
          start,
          end,
          allDay: false,
          color: provider === "google" ? "#ea4335" : "#0078d4",
        });
      }
    }
    day = addDays(day, 1);
  }
  return events;
}

/**
 * REQ-CAL-B15: Sync external calendar events
 */
export async function syncExternalEvents(userId: string, provider: string, timeMin: Date, timeMax: Date) {
  const integration = await prisma.externalCalendarIntegration.findUnique({
    where: { userId_provider: { userId, provider } },
  });
  if (!integration) throw new Error("Integration not connected");

  let events: any[];
  if (isDemoProvider(provider)) {
    events = generateStubEvents(provider, timeMin, timeMax);
  } else {
    // Refresh token if needed, then re-fetch integration
    await refreshTokensIfNeeded(userId);
    const freshIntegration = await prisma.externalCalendarIntegration.findUnique({
      where: { userId_provider: { userId, provider } },
    });
    if (!freshIntegration) throw new Error("Integration not found");
    const accessToken = decryptToken(freshIntegration.accessToken);

    if (provider === "google") {
      events = await googleOAuth.fetchEvents(accessToken, timeMin, timeMax);
    } else if (provider === "outlook") {
      events = await outlookOAuth.fetchEvents(accessToken, timeMin, timeMax);
    } else {
      throw new Error("Unknown provider");
    }
  }

  // Upsert events
  for (const event of events) {
    await prisma.externalCalendarEvent.upsert({
      where: {
        userId_provider_externalId: {
          userId,
          provider,
          externalId: event.externalId,
        },
      },
      update: {
        title: event.title,
        description: event.description,
        start: event.start,
        end: event.end,
        allDay: event.allDay,
        color: event.color,
        syncedAt: new Date(),
      },
      create: {
        userId,
        provider,
        externalId: event.externalId,
        title: event.title,
        description: event.description,
        start: event.start,
        end: event.end,
        allDay: event.allDay,
        color: event.color,
      },
    });
  }

  // Update last sync time
  await prisma.externalCalendarIntegration.update({
    where: { id: integration.id },
    data: { lastSyncAt: new Date() },
  });

  return events.length;
}
