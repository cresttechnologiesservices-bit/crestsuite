import path from "node:path";
import dotenv from "dotenv";
import { z } from "zod";

// Load apps/api/.env first, then fall back to the repo-root .env.
dotenv.config();
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

const env = z
  .object({
    DATABASE_URL: z.string(),
    REDIS_URL: z.string().default("redis://localhost:6379"),
    JWT_SECRET: z.string(),
    // SMTP_HOST: z.string().default("localhost"),
    // SMTP_PORT: z.coerce.number().default(1025),
    // SMTP_FROM: z.string().default("no-reply@clockit.local"),
    // SMTP Configuration
    SMTP_HOST: z.string().default("smtp.gmail.com"),
    SMTP_PORT: z.coerce.number().default(587),
    SMTP_USER: z.string().default("educatetrade02@gmail.com"),
    SMTP_PASS: z.string().default("iqiwiqmymtswmdly"),
    SMTP_FROM: z.string().default("educatetrade02@gmail.com"),
    APP_URL: z.string().default("http://localhost:5173"),
    API_URL: z.string().default("http://localhost:3000"),
    TURNSTILE_SECRET: z.string().default("test"),
    // Shared with the CrestSuite portal for single-sign-on token exchange
    PORTAL_SECRET: z.string().default("crestsuite-portal-dev-secret-change-in-production"),
    OVERTIME_DAILY_HOURS: z.coerce.number().default(8),
    // OAuth providers
    GOOGLE_CLIENT_ID: z.string().default(""),
    GOOGLE_CLIENT_SECRET: z.string().default(""),
    MICROSOFT_CLIENT_ID: z.string().default(""),
    MICROSOFT_CLIENT_SECRET: z.string().default(""),
    MICROSOFT_TENANT: z.string().default("common"),
    APPLE_CLIENT_ID: z.string().default(""),
    APPLE_TEAM_ID: z.string().default(""),
    APPLE_KEY_ID: z.string().default(""),
    APPLE_PRIVATE_KEY: z.string().default(""),
  })
  .parse(process.env);

export default env;
