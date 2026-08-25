# CREST Leave Management System

A full-stack leave management application implementing the **CREST Employee PTO Policy** and the yearly **Holiday Calendar** (2026 pre-loaded), with employee, manager and admin logins.

## Quick start

```bash
npm install
npm start
```

Open http://localhost:3000 (set `PORT` env var to change the port).

Data lives in `data/db.json` (created and seeded automatically on first run).
To reset everything to a fresh seeded state:

```bash
npm run seed -- --force
```

## Test accounts

All seeded accounts use the password **`Welcome@123`**.

| Role | Accounts |
|---|---|
| **Owner / Admin** | `hirkant@gmail.com` |
| **Admin** | `raj@crest-technologies.com`, `prabha@crestaerospace.com`, `ashwini.kumar@crestaerospace.com`, `mayurraju.shah@crestaerospace.com`, `pradnya.n@crestaerospace.com` |
| **Manager** | `vishal.bhandary@crestaerospace.com`, `jayanthkumar.singh@crestaerospace.com`, `gundappa.chatla@crestaerospace.com`, `prajwal.kulkarni@crestaerospace.com`, `sooriyaprakash.m@crestaerospace.com` |
| **Employee** (samples) | `amit.sharma@`, `neha.patil@`, `rohan.desai@`, `kavya.iyer@`, `arjun.rao@`, `sneha.kulkarni@`, `vivek.menon@`, `divya.nair@`, `karthik.reddy@`, `pooja.hegde@` (all `…crestaerospace.com`) |

Employees report to managers; managers report to an admin; admins report to the owner. Users can change their own password via the API (`POST /api/auth/change-password`); admins can reset any password to the default from the Employees page.

## PTO policy rules implemented

**Annual Leave (AL)**
- 20 working days/year, credited 5 days at the start of each calendar quarter.
- Mid-quarter joiners get a prorated credit for the joining quarter, rounded to the nearest integer.
- Whole days only; balance checks count leave already pending approval, and are re-checked at approval time.
- Balance for a future-dated leave is assessed as of its start date (leave accrued by then may be booked).
- Max 5 unused days carry forward (admin grants via *Reports → Balance adjustment*); carry-forward lapses 30 June.
- Encashment is not supported anywhere in the system, per policy.

**Sick Leave (SL)** — 5 days/year, no carry-over; 2+ continuous days require confirming a medical certificate; >1 month flags MD approval; balance exhausted → system directs to AL.

**Compensatory leave** — employee claims a credit for working a weekend/holiday (manager verifies and approves); each credit is valid **6 weeks** from the day worked; comp leave consumes the oldest valid credits and **cannot be clubbed** with adjacent approved leave of another type.

**Bereavement** — up to 5 paid workdays, immediate family member must be specified, not deducted from other balances.

**Loss of Pay (LOP)** — only allowed after AL is exhausted; always routed to Director/CEO (admin) for sanction.

**Maternity** — 26 calendar weeks (12 weeks from the third child onwards), counted in calendar days; 60-day notice reminder.

**Paternity** — 5 paid days, must fall within 4 weeks of the child's birth/legal adoption date.

**Approval routing**
- Requests go to the employee's manager.
- Any request **over 10 working days**, and all LOP, routes to the Director/CEO (admin).
- Admins can decide any request; nobody can approve their own.
- Pending requests and approved future leave can be cancelled by the employee (days are credited back automatically).

**Working-day counting** skips weekends, mandatory holidays, and the employee's own selected optional holidays.

## Additional features (industry-standard)

- **In-app notifications** — approvers are notified of new requests, claims and cancellations; employees are notified of decisions, balance adjustments and carry-forwards. Unread badge in the sidebar.
- **Team calendar** — month view of approved leave plus holidays. Employees see themselves, their peers and their manager; managers see their reports; admins see the whole organisation.
- **"Who's out this week"** card on every dashboard.
- **Leave ledger** — a transaction-style statement (quarterly accruals, carry-forwards, adjustments, leave taken, comp-off credits) per employee per year. Employees see their own; admins can open anyone's from Reports.
- **Supporting documents** — attach a medical certificate or other document (≤ 2 MB) to a leave request; visible to the approver.
- **Approval aging & conflict warnings** — approvers see how long a request has been waiting and whether teammates already have overlapping approved leave.
- **Year-end processing** — one click in Reports carries forward each employee's unused AL (max 5 days) into the next year; idempotent, with employee notifications.
- **CSV exports** — organisation-wide balances and full request history, per year.
- **Bradford factor** in admin Reports (spells² × sick days) to flag disruptive patterns of frequent short sick absences.

## Administration capabilities

- **Policy Settings page** (admins/owner) — edit the number of leave days for every leave type (annual, sick, bereavement, paternity, maternity weeks, carry-forward cap, comp-off validity, approval thresholds, notice period) as a **global rule** applying to everyone; the PTO-policy defaults can be restored with one click.
- **Per-employee policy overrides** (admins/owner) — from *Employees → Policy*, set any of those values for one employee independently. Effective policy = defaults → global rule → personal overrides; blank fields follow the global rule, and overridden employees show a "custom policy" badge. Changing the global rule never disturbs personal overrides; clearing overrides returns the employee to the global rule. The employee is notified either way.
- **Apply on behalf** — admins/owner can submit any type of leave for any employee from the Apply page; the employee is notified and the request goes through the normal approval flow, labelled "applied by …".
- **Full org-structure control** — admins/owner can add employees, edit role/manager/joining date, deactivate accounts, or **permanently remove** an employee (their reports are automatically re-assigned to the removed person's manager). The owner account cannot be removed or deactivated.
- **Approval notifications go to both the employee's manager and all admins** — on submission, cancellation, comp-off claims and every decision.
- **Self-service password change** — every user can change their own password from the sidebar ("Change password"); admins can reset a forgotten password to the default from the Employees page.

## Holiday calendar

- 2026 is seeded from the *Holiday Calendar 2026* document: 11 mandatory + 4 optional holidays, of which each employee may choose **2** (admin-configurable).
- Admins add next year's calendar under **Manage Holidays** (the calendar changes every year) and set that year's optional-holiday allowance.
- Employees pick their optional holidays on the **Holiday Calendar** page; selections are locked once the date has passed.

## Architecture

| Piece | Choice |
|---|---|
| Backend | Node.js + Express (`server/server.js` routes, `server/policy.js` business rules) |
| Storage | JSON file database (`server/db.js` → `data/db.json`) — zero native dependencies |
| Auth | JWT (12 h expiry), bcrypt-hashed passwords |
| Frontend | Dependency-free single-page app (`public/`) |

Set `JWT_SECRET` in production. Assumption made where the policy is silent: quarterly AL credit is granted at the *start* of each quarter (advance credit) so employees are not left with zero leave in Q1.
