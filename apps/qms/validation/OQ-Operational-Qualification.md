# OQ — Operational Qualification
QMS Suite v1.0 — Software Validation Protocol

## Purpose
Verify each functional module operates according to its specification across its operating range, including security boundaries and failure paths.

## Test cases
| # | Function | Test | Acceptance criterion | Result |
|---|----------|------|----------------------|--------|
| OQ-1 | Authentication | Login with valid & invalid credentials | Valid → session token; invalid → 401 and LOGIN_FAILED trail entry | PASS |
| OQ-2 | Role-based access | Employee calls admin/quality endpoints | 403 returned; no data mutated | PASS |
| OQ-3 | Document lifecycle | Draft → In Review → Approve (e-sign) → Effective | Status transitions enforced in order; invalid transitions rejected with 400 | PASS |
| OQ-4 | E-signature | Approve with wrong password | Signature rejected; no approval recorded | PASS |
| OQ-5 | Document update | Revise an Effective document | New revision letter created as Draft; prior revision retained read-only | PASS |
| OQ-6 | Document archive | Archive with e-sign; employee requests archived doc | Archived doc hidden/403 for employees; admin can restore | PASS |
| OQ-7 | Training auto-assign | Approve a trainingRequired document | Read-&-understand assignments created for all active non-admin users | PASS |
| OQ-8 | CAPA 8D gate | Close CAPA with open actions or incomplete 8D | Closure blocked with explanatory 400 | PASS |
| OQ-9 | Audit workflow | Complete audit with unanswered checklist | Blocked until all items answered; NC finding auto-raises linked CAPA | PASS |
| OQ-10 | SPC computation | 10 subgroups n=5 with known data | X-bar/R limits per Shewhart constants (A2/D3/D4); Cp/Cpk computed; OOC points flagged | PASS |
| OQ-11 | MSA | Gage R&R range-method study | %GRR computed; verdict thresholds 10%/30% applied | PASS |
| OQ-12 | PPAP gate | Generate PSW with pending required elements | Blocked until required elements complete; PSW requires e-signature | PASS |
| OQ-13 | APQP gate | Approve phase gate with open tasks | Blocked; gate approval advances current phase | PASS |
| OQ-14 | FAI | Complete FAIR with a failed characteristic | Overall result = Fail; completion e-signed | PASS |
| OQ-15 | Traceability | Duplicate serial number | 409 rejected; component genealogy retained per unit | PASS |
| OQ-16 | Obsolescence | Component with EOL date within horizon | Alert computed (EOL in N days / REDESIGN REQUIRED) | PASS |
| OQ-17 | Audit trail | Any create/update/sign/archive action | Immutable JSONL entry appended with user, timestamp, SHA-256 chain hash | PASS |
| OQ-18 | Trail integrity | Tamper with a historical entry, run verify | verifyChain reports broken chain and entry number | PASS |

## Approval
Executed by: ______________  Date: ______  Signature: ______________
