# CrestSuite

One portal, one login, three applications:

| App | Path | What it is |
| --- | --- | --- |
| ⏱️ **ClockIT** | `/clockit` | Time tracking (React + Vite web, Express + Prisma API, PostgreSQL) |
| 🌴 **LeaveMS** | `/leavems` | Leave management (Express + vanilla JS SPA, JSON file DB) |
| ✅ **QMS Suite** | `/qms` | Quality management (Express + vanilla JS SPA, JSON file DB) |

Sign in once at the portal (`http://localhost:8080`), then click an app icon —
the portal mints that app's own session token for you (single sign-on), so you
land inside each app already authenticated.

## Layout

```
CrestSuite/
  portal/            portal server (login, launcher, SSO, ClockIT proxy)
  apps/
    clockit/        the ClockIT monorepo (runs as its own processes)
    leavems/         mounted in-process at /leavems
    qms/             mounted in-process at /qms
```

## Quick start (portal + LeaveMS + QMS)

```bash
npm install
npm start
```

Open http://localhost:8080 and sign in with `hirkant@gmail.com` /
`Welcome@123` (the LeaveMS employee directory is the master user list — every
seeded user works with `Welcome@123`).

LeaveMS and QMS run inside the portal process; no extra steps.

## Enabling ClockIT

ClockIT needs Docker (PostgreSQL, Redis, MailHog) and its own install/build,
so it runs as separate processes that the portal proxies:

```bash
npm run clockit:install     # install the monorepo's dependencies
npm run clockit:db          # docker compose up + prisma migrate + seed
npm run clockit:web:build   # build the React app (served by the portal at /clockit)
npm run clockit:api         # start the API on :3000 (keep running)
```

Reload the portal — the ClockIT card turns green. Clicking it performs SSO:
the portal hands a short-lived signed token to `/clockit/?sso=...`, the
ClockIT API exchanges it for its normal session cookie and auto-provisions
the user on first visit.

## How the single sign-on works

- **Portal login** — checked against the LeaveMS user directory
  (`apps/leavems/data/db.json`, bcrypt) and issues an `httpOnly`
  `portal_token` cookie (JWT, 12 h).
- **LeaveMS** — the portal signs LeaveMS's own JWT (`{ id }`, shared
  `JWT_SECRET`) and stores it as `lms_token` in localStorage before opening
  `/leavems`.
- **QMS** — the portal calls QMS's own `signToken()` and stores
  `qms_token`/`qms_user`. Users missing from QMS are auto-provisioned with a
  mapped role (admin → admin, manager → quality, employee → employee).
- **ClockIT** — the portal redirects to `/clockit/?sso=<short-lived JWT>`;
  the new `POST /api/auth/sso` endpoint (in `apps/clockit/apps/api`) verifies
  it with the shared `PORTAL_SECRET`, upserts the user and sets the normal
  session cookie.

Each app's original login screen still works as a fallback (QMS SSO-created
users get a random password — set one from the QMS admin screen if needed).

## Accounts, passwords and resets

The LeaveMS employee directory is the master user list. Admins manage users in
**LeaveMS → Administration → Employees** (new users default to `Welcome@123`;
the edit screen can reset a password back to that default).

On the portal itself:

- **Change password** — button on the launcher header (asks for the current
  password, minimum 8 characters). Applies portal-wide since portal login and
  LeaveMS share the same record.
- **Forgot password?** — link on the sign-in card. Emails a single-use reset
  link valid for 30 minutes (the token is invalidated the moment the password
  changes). The email is sent via SMTP — see below.

## Configuration (`.env` at the repo root; copy `.env.example`)

| Variable | Default | Used by |
| --- | --- | --- |
| `PORTAL_PORT` | `8080` | portal |
| `PORTAL_URL` | `http://localhost:8080` | reset-link URLs in email |
| `PORTAL_SECRET` | dev default | portal + ClockIT API (must match) |
| `JWT_SECRET` | LeaveMS dev default | portal + LeaveMS (must match) |
| `CLOCKIT_API_URL` | `http://127.0.0.1:3000` | portal proxy |
| `SMTP_HOST` / `SMTP_PORT` | `localhost` / `1025` (MailHog) | reset emails |
| `SMTP_SECURE` | `false` (`true` for implicit TLS, port 465) | reset emails |
| `SMTP_USER` / `SMTP_PASS` | empty (no auth) | reset emails |
| `SMTP_FROM` | `CrestSuite Portal <no-reply@crestsuite.local>` | reset emails |

In dev, password-reset emails land in MailHog (`http://localhost:8025`, part
of ClockIT's docker compose). For production, set the `SMTP_*` variables to a
real server — `.env.example` has ready-made examples for Gmail, Office 365 and
SendGrid. The dev defaults are baked in so everything works out of the box;
change all secrets before any real deployment.

## Database

All three apps now store data in PostgreSQL (one server):

- **ClockIT** — its own `clockit` database via Prisma (unchanged).
- **LeaveMS + QMS** — a shared `crestsuite` database via
  [shared/jsonpg.js](shared/jsonpg.js): every record is a row in
  `app_records (app, collection, id, seq, data jsonb)`, non-record values in
  `app_meta`. Existing `data/db.json` files are imported automatically on
  first start. If PostgreSQL is down, the apps fall back to the JSON files
  with a console warning so `npm start` works without Docker.

## Running with Docker (everything containerized)

```bash
docker compose up -d --build
```

brings up PostgreSQL, Redis, MailHog, the ClockIT API container and the
portal container (which serves LeaveMS, QMS and the built ClockIT web app)
on http://localhost:8080. It reuses the same `clockit_pgdata` volume as
before, so data carries over — stop the old `apps/clockit` compose stack
and any local `npm start`/`clockit:api` processes first (ports 8080/5433
would clash).

## Notes

- Sign-out in any app clears that app's session and returns to the portal
  launcher; portal sign-out also clears the ClockIT session cookie.
- QMS Document Control supports **file attachments** (up to 10 MB per
  revision) with authenticated download; attachments live in the database
  with the revision.
- The LeaveMS holiday calendar is seeded from
  [apps/leavems/data/holiday-calendar.json](apps/leavems/data/holiday-calendar.json)
  (per-year entries — edit the file or use Administration → Manage Holidays).
- The LeaveMS Team Calendar shows a per-day **leave count** badge plus a
  monthly total/busiest-day summary.
- LeaveMS/QMS front-ends were re-pointed to `/leavems/api` and `/qms/api`;
  ClockIT's web app was rebased to `/clockit/` (Vite `base`, router
  `basename`, axios `baseURL`).
- Standalone runs still work: `node apps/leavems/server/server.js`,
  `node apps/qms/server.js` (each `require.main` guard keeps portal mounting
  possible).
