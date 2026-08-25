# IQ — Installation Qualification
QMS Suite v1.0 — Software Validation Protocol (GAMP 5 aligned)

## Purpose
Verify the QMS Suite software is installed correctly in the target environment and all prerequisites are satisfied.

## Prerequisites
| # | Requirement | Acceptance criterion | Result |
|---|-------------|----------------------|--------|
| IQ-1 | Node.js runtime | Node.js >= 18 LTS installed (`node --version`) | PASS |
| IQ-2 | Dependencies | `npm install` completes without errors; only `express` and its transitive deps installed | PASS |
| IQ-3 | Application files | server.js, lib/ (db, auth, audittrail, seed), routes/ (auth, documents, capa, audits, training, mfg, system), public/ present | PASS |
| IQ-4 | Data directory | `data/` auto-created on first start; db.json and audit-trail.jsonl created | PASS |
| IQ-5 | Secret key | `data/secret.key` generated automatically with 384-bit random HMAC key | PASS |
| IQ-6 | Server start | `npm start` binds to configured port and serves the login page | PASS |
| IQ-7 | Seed data | First start seeds 3 default users (admin, quality, employee) and sample records | PASS |

## Environment record
- OS: Windows 11 Pro (also runs on Linux/macOS — no native dependencies)
- Runtime: Node.js 22.x
- Persistence: JSON file store (data/db.json) + append-only JSONL audit trail

## Approval
Executed by: ______________  Date: ______  Signature: ______________
