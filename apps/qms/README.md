# QMS Suite

A complete Quality Management System web application for regulated manufacturing, supporting **ISO 9001:2015**, **ISO 13485**, **IATF 16949** (automotive), **AS9100D** (aerospace & defense) and **ISO 22163 / IRIS** (rail).

## Quick start

```
npm install
npm start
```

Open http://localhost:5601 (set `PORT` to change).

### Logins (seeded on first run)
| Role | Email | Password |
|------|-------|----------|
| Owner / Admin | hirkant@gmail.com | Owner@123 |
| Admin | raj@crest-technologies.com | Admin@123 |
| Admin | prabha@crestaerospace.com | Admin@123 |
| Admin | ashwini.kumar@crestaerospace.com | Admin@123 |
| Admin | mayurraju.shah@crestaerospace.com | Admin@123 |
| Admin | pradnya.n@crestaerospace.com | Admin@123 |
| Manager | vishal.bhandary@crestaerospace.com | Manager@123 |
| Manager | jayanthkumar.singh@crestaerospace.com | Manager@123 |
| Manager | gundappa.chatla@crestaerospace.com | Manager@123 |
| Manager | prajwal.kulkarni@crestaerospace.com | Manager@123 |
| Manager | sooriyaprakash.m@crestaerospace.com | Manager@123 |

Passwords are initial defaults — the owner/admin can reset them in User Management. Employee accounts can be created there as needed.

## Modules

**Quality core**
- **Document Control** — centralized repository, revision history (A/B/C…), lifecycle Draft → In Review → Approved → Effective → Archived, electronic sign-off (password re-entry, Part-11 style), **update (new revision)** and **archive/restore**, auto-assigned read-&-understand training on release. Documents are organized under category tabs (**ISO 9001, SDLC, Aerospace, Automotive, Industrial, IEC 62443, Others**) with filters for status, type and standard.
- **CAPA / 8D** — corrective & preventive actions, full 8-Disciplines workflow, 5-Why and fishbone (6M) root-cause tools, action tracking, e-signed verification & closure (gated on completeness).
- **Audits & LPA** — internal / external / supplier audits plus Layered Process Audits, checklist execution, findings with Major/Minor NC classification, auto-raised linked CAPAs, audit reports.
- **Training** — assignments, SOP acknowledgment with e-signature, competency matrix, overdue tracking.

**Core tools & traceability (IATF / AS9100 / IRIS)**
- **APQP** — 5-phase launch projects with task tracking and enforced phase-gate approvals.
- **PPAP** — 18-element packages, Part Submission Warrant generation (blocked until required elements complete), e-signed, customer disposition.
- **FMEA** — DFMEA/PFMEA with S/O/D, RPN and AIAG-VDA-style Action Priority, mitigation with revised RPN.
- **SPC & MSA** — live X-bar/R control charts (SVG), Shewhart control limits, Cp/Cpk capability, out-of-control detection; Gage R&R (range method) with %GRR verdict.
- **FAI (AS9102)** — Forms 1–3: part accountability, materials/processes with cert references, characteristic accountability, e-signed pass/fail.
- **Serialization & Traceability** — serial/batch genealogy down to raw-material mill certificates; recall search.
- **Obsolescence** — component lifecycle (Active/NRND/LTB/EOL/Obsolete) with automatic redesign alerts (rail/IRIS).
- **Suppliers** — approved supplier list with counterfeit-part avoidance checks and computed risk.

**Compliance & administration**
- **Audit Trail** — append-only JSONL log of who/what/when for every action, SHA-256 hash-chained (tamper-evident), with admin integrity verification.
- **Validation** — IQ/OQ/PQ protocols in `validation/`, viewable in-app.
- **User Management** — admin-managed accounts with three roles (Administrator / Quality Manager / Employee) and granular permission enforcement on every API route.

## Security notes
- Passwords hashed with scrypt (per-user salt); HMAC-signed expiring session tokens.
- Electronic signatures require password re-entry at signing time and are stored with signer identity, timestamp and signature hash.
- Role checks are enforced server-side on every endpoint; employees cannot approve, release, or see archived documents.

## Architecture
- `server.js` — Express app; `routes/` — REST API per module; `lib/` — JSON datastore, auth, tamper-evident audit trail, seed.
- `public/` — dependency-free single-page frontend (hash routing, SVG charts).
- `data/` — created at runtime: `db.json`, `audit-trail.jsonl`, `secret.key`. Delete the folder to reset the demo.
