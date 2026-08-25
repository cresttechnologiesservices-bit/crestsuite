# ClockIT Monorepo

A full-stack ClockIT-style time-tracking application.

## Stack

- **API** (`apps/api`): Node.js, Express, TypeScript, Prisma, PostgreSQL, Redis, Nodemailer (MailHog in dev)
- **Web** (`apps/web`): React 18, Vite, TypeScript, Tailwind CSS, React Query, Recharts
- **Shared** (`packages/shared`): shared Zod schemas and types

## Features

- Landing / Sign-up / Login with email OTP, Cloudflare Turnstile, and OAuth (Google, Microsoft, Apple)
- Time Tracker with live timer, manual entries, tags, billable flags, pagination
- Weekly Timesheet grid with copy-last-week, templates, and submit-for-approval
- Calendar (week/day) with drag-create, edit modal, working-days setting, and Google/Outlook calendar integration
- Dashboard with project/billability grouping, me/team scope, charts, and team activities
- Reports (Summary, Detailed, Weekly, Shared) with filters, sharing links, and PDF/CSV/Excel export
- Projects, Clients, and Team management (roles, groups, invitations)
- User account menu, profile, and preferences (general + email notifications)

## Getting started

```bash
cp .env.example .env
npm install
docker compose up -d          # postgres, redis, mailhog
npm run db:migrate
npm run db:seed
npm run dev                   # API on :3000, web on :5173
```

MailHog UI (dev email inbox): http://localhost:8025

Seed login: `owner@clockit.local` (use the email OTP flow; codes arrive in MailHog).

## Scripts

| Command            | Description                        |
| ------------------ | ---------------------------------- |
| `npm run dev`      | Start Docker services, API and web |
| `npm run build`    | Build all workspaces               |
| `npm run db:migrate` | Run Prisma migrations            |
| `npm run db:seed`  | Seed the database                  |

## Docs

- `docs/TIMESHEET_MODULE.md`, `docs/CALENDAR_MODULE.md`, `docs/DASHBOARD_MODULE.md`
- `docs/requirements-mapping.md` — requirement-to-code mapping
