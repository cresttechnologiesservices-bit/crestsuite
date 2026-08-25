# Requirements Mapping

High-level mapping of requirement groups to code. FE = frontend, BE = backend.

| Req group | Area | Backend | Frontend |
| --- | --- | --- | --- |
| REQ-LP | Landing | session check via `GET /api/users/me` | `web/src/routes/landing.tsx` |
| REQ-SU | Sign-up | `api/src/modules/auth/router.ts` (`/signup/*`), `oauth/` | `web/src/routes/signup.tsx` |
| REQ-LI | Login/OTP | `auth/router.ts` (`/email/request-otp`, `/verify-otp`, `/resend-otp`), `turnstile/`, `oauth/` | `web/src/routes/login.tsx`, `components/auth/TurnstileWidget.tsx` |
| REQ-ACC | Account & preferences | `modules/users/router.ts`, `notifications/` | `routes/profile.tsx`, `routes/preferences.tsx`, `components/preferences/*`, `components/layout/AccountMenu.tsx` |
| REQ-NAV | Sidebar | `modules/navigation/router.ts` (role-filtered menu) | `components/layout/Sidebar.tsx`, `Layout.tsx` |
| REQ-TS | Timesheet | `modules/timesheet/` (entries, totals, time-off, copy-last-week, templates, submit) | `routes/timesheet.tsx`, `components/timesheet/*` |
| REQ-TT | Time Tracker | `modules/timeEntries/` (start/stop/running, CRUD, duplicate/split, overlap check, overtime, pagination) | `routes/tracker.tsx`, `components/tracker/*` |
| REQ-CAL | Calendar | `modules/calendar/` (entries, preferences, Google/Outlook OAuth + sync) | `routes/calendar.tsx`, `components/calendar/*` |
| REQ-DASH | Dashboard | `modules/dashboard/` (summary, chart, breakdown, activities, team activities) | `routes/dashboard.tsx`, `components/dashboard/*` |
| REQ-REP | Reports | `modules/reports/` (summary/detailed/weekly, filters, share links, PDF/CSV/Excel export) | `routes/reports.tsx`, `routes/sharedReport.tsx`, `components/reports/*` |
| REQ-PROJ | Projects | `modules/projects/` (filters, sort, export, tasks, members, status metrics) | `routes/projects.tsx`, `components/projects/*` |
| REQ-CLI | Clients | `modules/clients/` (CRUD, archive, bulk) | `routes/clients.tsx`, `components/clients/*` |
| REQ-TEAM | Team | `modules/team/` (members, invites, roles, rates, groups, export) | `routes/team.tsx`, `components/team/*` |

## Known gaps / demo simplifications

- OAuth sign-in buttons are visual-only until provider client IDs are configured in `.env`; backend token verification is implemented for Google, Microsoft, and Apple.
- Google/Outlook calendar integrations run in a stub mode (demo tokens + seeded events) when no client IDs are configured; real OAuth flow is used when configured.
- Dashboard grouping/scope preferences persist via localStorage + an in-memory server store (no schema column).
- Project favorites persist via localStorage (`ProjectFavorite` model would be needed server-side).
- "Set as template" for projects, attendance report, and invoice-related report controls are out of demo scope.
- Multi-role per member is not supported (single `User.role` enum).
- Report export settings persist in localStorage and are sent with each export request.
