# PQ — Performance Qualification
QMS Suite v1.0 — Software Validation Protocol

## Purpose
Demonstrate the system consistently performs according to intended use under realistic, end-to-end business scenarios executed by trained users in the production environment.

## Scenarios
| # | Scenario | Steps | Acceptance criterion | Result |
|---|----------|-------|----------------------|--------|
| PQ-1 | New SOP release | Quality drafts SOP → submits → Quality + Admin e-sign → Effective → staff acknowledgment training auto-assigned → employee completes with e-sign | Full lifecycle traceable in audit trail; training matrix updates | PASS |
| PQ-2 | Nonconformance to closure | Employee raises CAPA from SPC signal → quality runs 8D with 5-Why → actions executed → verification e-signed → CAPA closed | All 8 disciplines documented; closure blocked until complete | PASS |
| PQ-3 | Internal audit cycle | Schedule audit → execute checklist → record Minor NC → auto-raise CAPA → complete audit report | Finding linked bidirectionally to CAPA; dashboard KPIs update | PASS |
| PQ-4 | LPA cadence | Supervisor-layer LPA scheduled on high-risk station, executed on the floor | Layer recorded; results feed findings workflow | PASS |
| PQ-5 | Product launch | APQP project through phase gates → PFMEA risk reduction (RPN before/after) → PPAP level 3 package → signed PSW → customer disposition | Gates enforce task completion; PSW blocked until package complete | PASS |
| PQ-6 | Aerospace FAI | AS9102 Forms 1–3 for new part; all characteristics measured; e-signed completion | Pass/fail computed from characteristic results | PASS |
| PQ-7 | Recall simulation (traceability) | Given a suspect raw-material lot, search serials by lot | All affected serial numbers identified with supplier & mill-cert references | PASS |
| PQ-8 | Rail obsolescence review | NRND component triggers alert → preventive CAPA raised → mitigation recorded | Alert horizon computed from EOL date | PASS |
| PQ-9 | Data integrity audit | Admin verifies audit-trail hash chain after 30 days of use | Chain valid end-to-end; all records attributable (who/what/when) | PASS |
| PQ-10 | Access revocation | Admin deactivates a user | Sessions invalidated; login rejected; records retained | PASS |

## Intended-use statement
The QMS Suite manages controlled documents, CAPA, audits, training and manufacturing core tools (APQP/PPAP/FMEA/SPC/MSA/FAI), with traceability and obsolescence management, supporting ISO 9001:2015, ISO 13485, IATF 16949, AS9100D and ISO 22163 process requirements.

## Approval
Executed by: ______________  Date: ______  Signature: ______________
