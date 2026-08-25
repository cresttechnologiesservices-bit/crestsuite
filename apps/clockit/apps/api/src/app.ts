// Must come first: patches the Router so a rejected async handler reaches the
// error middleware instead of becoming an unhandled rejection that exits Node.
import "./lib/asyncRoutes";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import authRouter from "./modules/auth/router";
import oauthRouter from "./modules/oauth/router";
import turnstileRouter from "./modules/turnstile/router";
import timeEntriesRouter from "./modules/timeEntries/router";
import projectsRouter from "./modules/projects/router";
import clientsRouter from "./modules/clients/router";
import timesheetRouter from "./modules/timesheet/router";
import calendarRouter from "./modules/calendar/router";
import dashboardRouter from "./modules/dashboard/router";
import reportsRouter from "./modules/reports/router";
import teamRouter from "./modules/team/router";
import notificationsRouter from "./modules/notifications/router";
import usersRouter from "./modules/users/router";
import navigationRouter from "./modules/navigation/router";
import workspaceRouter from "./modules/workspace/router";
import customFieldsRouter from "./modules/customFields/router";
import internalRouter from "./modules/internal/router";
import { errorHandler } from "./middleware/errors";
import { sanitizeRequest } from "./middleware/sanitize";

export const app = express();
app.use(cors({ origin: process.env.APP_URL ?? "http://localhost:5173", credentials: true }));
app.use(express.json({ limit: "10mb" }));
app.use(cookieParser());
// Drop NUL/control characters Postgres cannot store before they reach Prisma
app.use(sanitizeRequest);
// Trust proxy for correct IP detection (needed for Turnstile)
app.set("trust proxy", 1);
app.get("/health", (_req, res) => res.json({ status: "ok" }));
app.use("/api/auth", authRouter);
app.use("/api/auth/oauth", oauthRouter);
app.use("/api/auth/turnstile", turnstileRouter);
app.use("/api/time-entries", timeEntriesRouter);
app.use("/api/projects", projectsRouter);
app.use("/api/clients", clientsRouter);
app.use("/api/timesheet", timesheetRouter);
app.use("/api/calendar", calendarRouter);
app.use("/api/dashboard", dashboardRouter);
app.use("/api/reports", reportsRouter);
app.use("/api/team", teamRouter);
app.use("/api/notifications", notificationsRouter);
app.use("/api/users", usersRouter);
app.use("/api/navigation", navigationRouter);
app.use("/api/workspace", workspaceRouter);
app.use("/api/custom-fields", customFieldsRouter);
// Portal-to-API only; the portal proxy refuses to forward this path
app.use("/api/internal", internalRouter);
app.use(errorHandler);