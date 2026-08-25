// Manufacturing quality modules for IATF 16949 / AS9100 / ISO 22163:
// APQP, PPAP/PSW, FMEA, SPC (X-bar/R + Cp/Cpk), MSA (Gage R&R),
// FAI (AS9102), serialization/traceability, obsolescence, suppliers.
const express = require('express');
const { coll, byId, newId, save, nextNumber } = require('../lib/db');
const { authRequired, requireRole, verifySignature } = require('../lib/auth');
const trail = require('../lib/audittrail');

const router = express.Router();
router.use(authRequired);

// ============ APQP ============
const APQP_PHASES = [
  'Phase 1 — Plan & Define Program',
  'Phase 2 — Product Design & Development',
  'Phase 3 — Process Design & Development',
  'Phase 4 — Product & Process Validation',
  'Phase 5 — Launch, Feedback & Corrective Action'
];

router.get('/apqp', (req, res) => res.json(coll('apqp')));
router.get('/apqp/:id', (req, res) => {
  const p = byId('apqp', req.params.id);
  if (!p) return res.status(404).json({ error: 'APQP project not found' });
  res.json(p);
});

router.post('/apqp', requireRole('quality'), (req, res) => {
  const { name, customer, partNumber, targetSOP } = req.body || {};
  if (!name || !partNumber) return res.status(400).json({ error: 'name and partNumber are required' });
  const project = {
    id: newId('apqp'), projectNumber: nextNumber('APQP', 'APQP'),
    name, customer: customer || '', partNumber, targetSOP: targetSOP || '',
    currentPhase: 1, status: 'Active',
    phases: APQP_PHASES.map((n, i) => ({
      number: i + 1, name: n, tasks: [], gateApproved: false, gateApprovedBy: null, gateApprovedAt: null
    })),
    createdBy: req.user.name, createdAt: new Date().toISOString()
  };
  coll('apqp').push(project);
  save();
  trail.record(req.user, 'CREATE', 'apqp', project.id, `APQP project ${project.projectNumber} "${name}" for part ${partNumber}`);
  res.status(201).json(project);
});

router.post('/apqp/:id/tasks', requireRole('quality'), (req, res) => {
  const p = byId('apqp', req.params.id);
  if (!p) return res.status(404).json({ error: 'APQP project not found' });
  const { phase, name, owner, dueDate } = req.body || {};
  const ph = p.phases.find(x => x.number === Number(phase));
  if (!ph || !name) return res.status(400).json({ error: 'valid phase and task name required' });
  ph.tasks.push({ id: newId('tsk'), name, owner: owner || '', dueDate: dueDate || '', status: 'Open' });
  save();
  trail.record(req.user, 'UPDATE', 'apqp', p.id, `${p.projectNumber}: task "${name}" added to phase ${phase}`);
  res.json(p);
});

router.put('/apqp/:id/tasks/:taskId', (req, res) => {
  const p = byId('apqp', req.params.id);
  if (!p) return res.status(404).json({ error: 'APQP project not found' });
  for (const ph of p.phases) {
    const t = ph.tasks.find(x => x.id === req.params.taskId);
    if (t) {
      if (req.body.status) t.status = req.body.status;
      save();
      trail.record(req.user, 'UPDATE', 'apqp', p.id, `${p.projectNumber}: task "${t.name}" -> ${t.status}`);
      return res.json(p);
    }
  }
  res.status(404).json({ error: 'Task not found' });
});

// Phase-gate approval: all tasks in the phase must be closed
router.post('/apqp/:id/gate/:phase', requireRole('quality'), (req, res) => {
  const p = byId('apqp', req.params.id);
  if (!p) return res.status(404).json({ error: 'APQP project not found' });
  const ph = p.phases.find(x => x.number === Number(req.params.phase));
  if (!ph) return res.status(404).json({ error: 'Phase not found' });
  if (ph.number !== p.currentPhase) {
    return res.status(400).json({ error: `Phase gates must be approved in order — the project is currently in phase ${p.currentPhase}` });
  }
  const open = ph.tasks.filter(t => t.status !== 'Complete');
  if (open.length) return res.status(400).json({ error: `${open.length} task(s) still open in this phase` });
  ph.gateApproved = true;
  ph.gateApprovedBy = req.user.name;
  ph.gateApprovedAt = new Date().toISOString();
  if (p.currentPhase < 5) p.currentPhase++;
  else p.status = 'Launched';
  save();
  trail.record(req.user, 'APPROVE', 'apqp', p.id, `${p.projectNumber}: gate approved for ${ph.name}`);
  res.json(p);
});

// ============ PPAP ============
const PPAP_ELEMENTS = [
  'Design Records', 'Engineering Change Documents', 'Customer Engineering Approval',
  'DFMEA', 'Process Flow Diagram', 'PFMEA', 'Control Plan', 'MSA Studies',
  'Dimensional Results', 'Material / Performance Test Results', 'Initial Process Studies (SPC)',
  'Qualified Laboratory Documentation', 'Appearance Approval Report', 'Sample Production Parts',
  'Master Sample', 'Checking Aids', 'Customer-Specific Requirements', 'Part Submission Warrant (PSW)'
];

router.get('/ppap', (req, res) => res.json(coll('ppap')));
router.get('/ppap/:id', (req, res) => {
  const p = byId('ppap', req.params.id);
  if (!p) return res.status(404).json({ error: 'PPAP not found' });
  res.json(p);
});

router.post('/ppap', requireRole('quality'), (req, res) => {
  const { partNumber, partName, customer, level, reason } = req.body || {};
  if (!partNumber || !partName) return res.status(400).json({ error: 'partNumber and partName are required' });
  const lvl = Math.min(5, Math.max(1, Number(level) || 3));
  const ppap = {
    id: newId('ppap'), ppapNumber: nextNumber('PPAP', 'PPAP'),
    partNumber, partName, customer: customer || '', level: lvl,
    reason: reason || 'Initial submission',
    status: 'In Progress',
    elements: PPAP_ELEMENTS.map(name => ({ id: newId('el'), name, required: lvl >= 3, status: 'Pending', evidence: '' })),
    psw: null,
    createdBy: req.user.name, createdAt: new Date().toISOString()
  };
  coll('ppap').push(ppap);
  save();
  trail.record(req.user, 'CREATE', 'ppap', ppap.id, `${ppap.ppapNumber} for ${partNumber} (level ${lvl})`);
  res.status(201).json(ppap);
});

router.put('/ppap/:id/elements/:elId', requireRole('quality'), (req, res) => {
  const p = byId('ppap', req.params.id);
  if (!p) return res.status(404).json({ error: 'PPAP not found' });
  const el = p.elements.find(e => e.id === req.params.elId);
  if (!el) return res.status(404).json({ error: 'Element not found' });
  if (req.body.status) el.status = req.body.status;   // Pending | Complete | N/A
  if (req.body.evidence !== undefined) el.evidence = req.body.evidence;
  if (req.body.required !== undefined) el.required = !!req.body.required;
  save();
  trail.record(req.user, 'UPDATE', 'ppap', p.id, `${p.ppapNumber}: element "${el.name}" -> ${el.status}`);
  res.json(p);
});

// Generate Part Submission Warrant — requires all required elements complete + e-signature
router.post('/ppap/:id/psw', requireRole('quality'), (req, res) => {
  const p = byId('ppap', req.params.id);
  if (!p) return res.status(404).json({ error: 'PPAP not found' });
  const pending = p.elements.filter(e => e.required && e.status === 'Pending' && e.name !== 'Part Submission Warrant (PSW)');
  if (pending.length) return res.status(400).json({ error: `Required elements pending: ${pending.map(e => e.name).join(', ')}` });
  const sig = verifySignature(req);
  if (!sig.ok) return res.status(400).json({ error: sig.error });
  const { declaration, submissionResult } = req.body || {};
  p.psw = {
    generatedAt: new Date().toISOString(),
    declaration: declaration || 'The results meet all design record requirements and this part is submitted for approval.',
    submissionResult: submissionResult || 'Approved',
    signature: sig.signature
  };
  p.status = 'Submitted';
  const pswEl = p.elements.find(e => e.name.includes('PSW'));
  if (pswEl) pswEl.status = 'Complete';
  save();
  trail.record(req.user, 'SIGN', 'ppap', p.id, `${p.ppapNumber}: PSW generated and signed`);
  res.json(p);
});

router.post('/ppap/:id/disposition', requireRole('quality'), (req, res) => {
  const p = byId('ppap', req.params.id);
  if (!p) return res.status(404).json({ error: 'PPAP not found' });
  if (!p.psw) return res.status(400).json({ error: 'Generate the PSW first' });
  const d = req.body.disposition;
  if (!['Approved', 'Interim Approval', 'Rejected'].includes(d)) return res.status(400).json({ error: 'disposition must be Approved, Interim Approval or Rejected' });
  p.status = d;
  p.dispositionBy = req.user.name;
  p.dispositionAt = new Date().toISOString();
  save();
  trail.record(req.user, 'APPROVE', 'ppap', p.id, `${p.ppapNumber} dispositioned: ${d}`);
  res.json(p);
});

// ============ FMEA ============
function apRating(S, O, D) {
  // Simplified AIAG-VDA Action Priority
  if (S >= 9 && O >= 4) return 'H';
  const rpn = S * O * D;
  if (rpn >= 200) return 'H';
  if (rpn >= 100) return 'M';
  return 'L';
}

router.get('/fmea', (req, res) => res.json(coll('fmea')));
router.get('/fmea/:id', (req, res) => {
  const f = byId('fmea', req.params.id);
  if (!f) return res.status(404).json({ error: 'FMEA not found' });
  res.json(f);
});

router.post('/fmea', requireRole('quality'), (req, res) => {
  const { type, subject, partNumber, team } = req.body || {};
  if (!subject) return res.status(400).json({ error: 'subject is required' });
  const f = {
    id: newId('fmea'), fmeaNumber: nextNumber('FMEA', 'FMEA'),
    type: type === 'DFMEA' ? 'DFMEA' : 'PFMEA',
    subject, partNumber: partNumber || '', team: team || '',
    rows: [], status: 'Active',
    createdBy: req.user.name, createdAt: new Date().toISOString()
  };
  coll('fmea').push(f);
  save();
  trail.record(req.user, 'CREATE', 'fmea', f.id, `${f.fmeaNumber} (${f.type}) for ${subject}`);
  res.status(201).json(f);
});

router.post('/fmea/:id/rows', requireRole('quality'), (req, res) => {
  const f = byId('fmea', req.params.id);
  if (!f) return res.status(404).json({ error: 'FMEA not found' });
  const { item, failureMode, effect, severity, cause, occurrence, controls, detection, recommendedAction, owner, dueDate } = req.body || {};
  if (!item || !failureMode) return res.status(400).json({ error: 'item and failureMode are required' });
  const S = Math.min(10, Math.max(1, Number(severity) || 1));
  const O = Math.min(10, Math.max(1, Number(occurrence) || 1));
  const D = Math.min(10, Math.max(1, Number(detection) || 1));
  const row = {
    id: newId('row'), item, failureMode, effect: effect || '', severity: S,
    cause: cause || '', occurrence: O, controls: controls || '', detection: D,
    rpn: S * O * D, ap: apRating(S, O, D),
    recommendedAction: recommendedAction || '', owner: owner || '', dueDate: dueDate || '',
    actionTaken: '', revised: null
  };
  f.rows.push(row);
  save();
  trail.record(req.user, 'UPDATE', 'fmea', f.id, `${f.fmeaNumber}: row added — ${failureMode} (RPN ${row.rpn}, AP ${row.ap})`);
  res.json(f);
});

router.put('/fmea/:id/rows/:rowId', requireRole('quality'), (req, res) => {
  const f = byId('fmea', req.params.id);
  if (!f) return res.status(404).json({ error: 'FMEA not found' });
  const row = f.rows.find(r => r.id === req.params.rowId);
  if (!row) return res.status(404).json({ error: 'Row not found' });
  const { actionTaken, revisedSeverity, revisedOccurrence, revisedDetection } = req.body || {};
  if (actionTaken !== undefined) row.actionTaken = actionTaken;
  if (revisedSeverity || revisedOccurrence || revisedDetection) {
    const S = Math.min(10, Math.max(1, Number(revisedSeverity) || row.severity));
    const O = Math.min(10, Math.max(1, Number(revisedOccurrence) || row.occurrence));
    const D = Math.min(10, Math.max(1, Number(revisedDetection) || row.detection));
    row.revised = { severity: S, occurrence: O, detection: D, rpn: S * O * D, ap: apRating(S, O, D) };
  }
  save();
  trail.record(req.user, 'UPDATE', 'fmea', f.id, `${f.fmeaNumber}: row "${row.failureMode}" mitigation updated${row.revised ? ` (RPN ${row.rpn} -> ${row.revised.rpn})` : ''}`);
  res.json(f);
});

// ============ SPC ============
// Control chart constants for subgroup sizes 2..10 (X-bar/R charts)
const SPC_CONST = {
  2: { A2: 1.880, D3: 0, D4: 3.267, d2: 1.128 },
  3: { A2: 1.023, D3: 0, D4: 2.574, d2: 1.693 },
  4: { A2: 0.729, D3: 0, D4: 2.282, d2: 2.059 },
  5: { A2: 0.577, D3: 0, D4: 2.114, d2: 2.326 },
  6: { A2: 0.483, D3: 0, D4: 2.004, d2: 2.534 },
  7: { A2: 0.419, D3: 0.076, D4: 1.924, d2: 2.704 },
  8: { A2: 0.373, D3: 0.136, D4: 1.864, d2: 2.847 },
  9: { A2: 0.337, D3: 0.184, D4: 1.816, d2: 2.970 },
  10: { A2: 0.308, D3: 0.223, D4: 1.777, d2: 3.078 }
};

function spcStats(chart) {
  const groups = chart.subgroups;
  if (!groups.length) return null;
  const n = chart.subgroupSize;
  const c = SPC_CONST[n] || SPC_CONST[5];
  const xbars = groups.map(g => g.values.reduce((a, b) => a + b, 0) / g.values.length);
  const ranges = groups.map(g => Math.max(...g.values) - Math.min(...g.values));
  const xbarbar = xbars.reduce((a, b) => a + b, 0) / xbars.length;
  const rbar = ranges.reduce((a, b) => a + b, 0) / ranges.length;
  const sigma = rbar / c.d2;
  const stats = {
    xbarbar: +xbarbar.toFixed(4), rbar: +rbar.toFixed(4), sigma: +sigma.toFixed(4),
    xUCL: +(xbarbar + c.A2 * rbar).toFixed(4), xLCL: +(xbarbar - c.A2 * rbar).toFixed(4),
    rUCL: +(c.D4 * rbar).toFixed(4), rLCL: +(c.D3 * rbar).toFixed(4),
    xbars: xbars.map(v => +v.toFixed(4)), ranges: ranges.map(v => +v.toFixed(4)),
    cp: null, cpk: null, outOfControl: []
  };
  if (chart.usl != null && chart.lsl != null && sigma > 0) {
    stats.cp = +(((chart.usl - chart.lsl) / (6 * sigma))).toFixed(3);
    stats.cpk = +Math.min(
      (chart.usl - xbarbar) / (3 * sigma),
      (xbarbar - chart.lsl) / (3 * sigma)
    ).toFixed(3);
  }
  xbars.forEach((v, i) => {
    if (v > stats.xUCL || v < stats.xLCL) stats.outOfControl.push({ subgroup: i + 1, chart: 'X-bar', value: +v.toFixed(4) });
  });
  ranges.forEach((v, i) => {
    if (v > stats.rUCL || v < stats.rLCL) stats.outOfControl.push({ subgroup: i + 1, chart: 'R', value: +v.toFixed(4) });
  });
  return stats;
}

// Charts created before chart numbers existed get one on first read, so the
// list never shows a blank identifier.
function ensureChartNumbers() {
  let changed = false;
  for (const ch of coll('spc')) {
    if (!ch.chartNumber) {
      ch.chartNumber = nextNumber('SPC', 'SPC');
      changed = true;
    }
  }
  if (changed) save();
}

router.get('/spc', (req, res) => {
  ensureChartNumbers();
  res.json(coll('spc').map(ch => ({ ...ch, stats: spcStats(ch) })));
});
router.get('/spc/:id', (req, res) => {
  ensureChartNumbers();
  const ch = byId('spc', req.params.id);
  if (!ch) return res.status(404).json({ error: 'Chart not found' });
  res.json({ ...ch, stats: spcStats(ch) });
});

router.post('/spc', requireRole('quality'), (req, res) => {
  const { partNumber, characteristic, unit, usl, lsl, subgroupSize } = req.body || {};
  if (!partNumber || !characteristic) return res.status(400).json({ error: 'partNumber and characteristic are required' });
  const ch = {
    // Each chart carries its own sequential number (SPC-2026-0001), like MSA
    // studies. The part number is deliberately not unique: one part normally
    // has several charts, one per characteristic.
    id: newId('spc'), chartNumber: nextNumber('SPC', 'SPC'),
    partNumber, characteristic, unit: unit || 'mm',
    usl: usl != null ? Number(usl) : null, lsl: lsl != null ? Number(lsl) : null,
    subgroupSize: Math.min(10, Math.max(2, Number(subgroupSize) || 5)),
    subgroups: [], createdBy: req.user.name, createdAt: new Date().toISOString()
  };
  coll('spc').push(ch);
  save();
  trail.record(req.user, 'CREATE', 'spc', ch.id, `${ch.chartNumber}: SPC chart for ${partNumber} / ${characteristic}`);
  res.status(201).json({ ...ch, stats: null });
});

// Any operator (employee) may record measurements
router.post('/spc/:id/subgroups', (req, res) => {
  const ch = byId('spc', req.params.id);
  if (!ch) return res.status(404).json({ error: 'Chart not found' });
  const values = (req.body.values || []).map(Number).filter(v => !isNaN(v));
  if (values.length !== ch.subgroupSize) return res.status(400).json({ error: `Exactly ${ch.subgroupSize} numeric values required` });
  // Reject duplicate subgroups: the same set of measurements may not be recorded twice
  const key = g => g.slice().sort((a, b) => a - b).join(',');
  const dupIdx = ch.subgroups.findIndex(g => key(g.values) === key(values));
  if (dupIdx !== -1) {
    return res.status(409).json({ error: `Duplicate subgroup — these values were already recorded as subgroup #${dupIdx + 1}` });
  }
  ch.subgroups.push({ values, recordedBy: req.user.name, at: new Date().toISOString() });
  save();
  const stats = spcStats(ch);
  trail.record(req.user, 'UPDATE', 'spc', ch.id, `Subgroup #${ch.subgroups.length} recorded for ${ch.partNumber}/${ch.characteristic}${stats && stats.outOfControl.length ? ' — OUT OF CONTROL point(s) present' : ''}`);
  res.json({ ...ch, stats });
});

// ============ MSA (Gage R&R — range method, simplified) ============
router.get('/msa', (req, res) => res.json(coll('msa')));

function msaMeasurementError(measurements) {
  if (!Array.isArray(measurements) || !measurements.length) {
    return 'At least one measurement line is required (appraiser, part, then 2–3 numeric trial values)';
  }
  if (measurements.some(m => !m || !Array.isArray(m.values) || m.values.length < 2 || m.values.some(v => typeof v !== 'number' || Number.isNaN(v)))) {
    return 'Each measurement line needs at least two numeric trial values';
  }
  return null;
}

// Range-method %GRR: average range across appraiser/part cells -> equipment variation
function grrResults(measurements, tolerance) {
  const allRanges = measurements.map(m => Math.max(...m.values) - Math.min(...m.values));
  const rbar = allRanges.reduce((a, b) => a + b, 0) / allRanges.length;
  const d2 = { 2: 1.128, 3: 1.693 }[(measurements[0].values || []).length] || 1.128;
  const grr = (5.15 * rbar / d2);
  const tol = Number(tolerance) || null;
  const pctGRR = tol ? +((grr / tol) * 100).toFixed(1) : null;
  const verdict = pctGRR == null ? 'N/A' : pctGRR < 10 ? 'Acceptable' : pctGRR <= 30 ? 'Marginal' : 'Unacceptable';
  return { tol, results: { rbar: +rbar.toFixed(4), grr: +grr.toFixed(4), pctGRR, verdict } };
}

router.post('/msa', requireRole('quality'), (req, res) => {
  const { gage, characteristic, partNumber, appraisers, trials, measurements, tolerance } = req.body || {};
  // measurements: array [appraiser][part][trial] simplified as flat array of {appraiser, part, values[]}
  if (!gage) return res.status(400).json({ error: 'gage is required' });
  const measErr = msaMeasurementError(measurements);
  if (measErr) return res.status(400).json({ error: measErr });
  const { tol, results } = grrResults(measurements, tolerance);
  const { pctGRR, verdict } = results;
  const study = {
    id: newId('msa'), studyNumber: nextNumber('MSA', 'MSA'),
    gage, characteristic: characteristic || '', partNumber: partNumber || '',
    appraisers: appraisers || measurements.length, trials: trials || (measurements[0].values || []).length,
    measurements, tolerance: tol,
    results,
    performedBy: req.user.name, createdAt: new Date().toISOString()
  };
  coll('msa').push(study);
  save();
  trail.record(req.user, 'CREATE', 'msa', study.id, `Gage R&R ${study.studyNumber} on ${gage}: %GRR=${pctGRR ?? 'n/a'} (${verdict})`);
  res.status(201).json(study);
});

// Edit an existing study; results are recomputed from the updated data
router.put('/msa/:id', requireRole('quality'), (req, res) => {
  const study = byId('msa', req.params.id);
  if (!study) return res.status(404).json({ error: 'Study not found' });
  const { gage, characteristic, partNumber, measurements, tolerance } = req.body || {};
  if (!gage) return res.status(400).json({ error: 'gage is required' });
  const measErr = msaMeasurementError(measurements);
  if (measErr) return res.status(400).json({ error: measErr });
  const { tol, results } = grrResults(measurements, tolerance !== undefined ? tolerance : study.tolerance);
  study.gage = gage;
  if (characteristic !== undefined) study.characteristic = characteristic;
  if (partNumber !== undefined) study.partNumber = partNumber;
  study.measurements = measurements;
  study.tolerance = tol;
  study.appraisers = measurements.length;
  study.trials = (measurements[0].values || []).length;
  study.results = results;
  study.updatedBy = req.user.name;
  study.updatedAt = new Date().toISOString();
  save();
  trail.record(req.user, 'UPDATE', 'msa', study.id, `Gage R&R ${study.studyNumber} edited on ${study.gage}: %GRR=${results.pctGRR ?? 'n/a'} (${results.verdict})`);
  res.json(study);
});

// ============ FAI (AS9102) ============
router.get('/fai', (req, res) => res.json(coll('fai')));
router.get('/fai/:id', (req, res) => {
  const f = byId('fai', req.params.id);
  if (!f) return res.status(404).json({ error: 'FAI not found' });
  res.json(f);
});

router.post('/fai', requireRole('quality'), (req, res) => {
  const { partNumber, partName, revision, drawingNumber, serialNumber, reason } = req.body || {};
  if (!partNumber || !partName) return res.status(400).json({ error: 'partNumber and partName are required' });
  const f = {
    id: newId('fai'), fairNumber: nextNumber('FAI', 'FAIR'),
    // AS9102 Form 1: Part Number Accountability
    form1: { partNumber, partName, revision: revision || 'A', drawingNumber: drawingNumber || '', serialNumber: serialNumber || '', fullFAI: true, reason: reason || 'New part introduction' },
    // Form 2: Product Accountability (materials/processes) — free entries
    form2: [],
    // Form 3: Characteristic Accountability
    characteristics: [],
    status: 'In Progress', result: null,
    createdBy: req.user.name, createdAt: new Date().toISOString()
  };
  coll('fai').push(f);
  save();
  trail.record(req.user, 'CREATE', 'fai', f.id, `${f.fairNumber} opened for ${partNumber} rev ${f.form1.revision}`);
  res.status(201).json(f);
});

router.post('/fai/:id/form2', requireRole('quality'), (req, res) => {
  const f = byId('fai', req.params.id);
  if (!f) return res.status(404).json({ error: 'FAI not found' });
  const { materialOrProcess, specification, certNumber, supplier } = req.body || {};
  if (!materialOrProcess) return res.status(400).json({ error: 'materialOrProcess is required' });
  f.form2.push({ id: newId('f2'), materialOrProcess, specification: specification || '', certNumber: certNumber || '', supplier: supplier || '' });
  save();
  res.json(f);
});

router.post('/fai/:id/characteristics', requireRole('quality'), (req, res) => {
  const f = byId('fai', req.params.id);
  if (!f) return res.status(404).json({ error: 'FAI not found' });
  const { charNumber, requirement, actual, tooling } = req.body || {};
  if (!requirement || actual === undefined) return res.status(400).json({ error: 'requirement and actual are required' });
  f.characteristics.push({
    id: newId('chr'), charNumber: charNumber || String(f.characteristics.length + 1),
    requirement, actual, tooling: tooling || '',
    result: req.body.result === 'Fail' ? 'Fail' : 'Pass'
  });
  save();
  res.json(f);
});

router.post('/fai/:id/complete', requireRole('quality'), (req, res) => {
  const f = byId('fai', req.params.id);
  if (!f) return res.status(404).json({ error: 'FAI not found' });
  if (!f.characteristics.length) return res.status(400).json({ error: 'Record at least one characteristic (Form 3) first' });
  const sig = verifySignature(req);
  if (!sig.ok) return res.status(400).json({ error: sig.error });
  const failed = f.characteristics.filter(c => c.result === 'Fail');
  f.result = failed.length ? 'Fail' : 'Pass';
  f.status = 'Complete';
  f.signature = sig.signature;
  f.completedAt = new Date().toISOString();
  save();
  trail.record(req.user, 'SIGN', 'fai', f.id, `${f.fairNumber} completed: ${f.result} (${failed.length} nonconforming characteristic(s))`);
  res.json(f);
});

// ============ Serialization / Traceability ============
router.get('/serials', (req, res) => {
  const { q } = req.query;
  let items = coll('serials');
  if (q) {
    const s = q.toLowerCase();
    items = items.filter(x => x.serialNumber.toLowerCase().includes(s) || x.partNumber.toLowerCase().includes(s) || (x.batch || '').toLowerCase().includes(s));
  }
  res.json(items);
});

router.post('/serials', (req, res) => {
  const { serialNumber, partNumber, partRevision, batch, buildDate, components } = req.body || {};
  if (!serialNumber || !partNumber) return res.status(400).json({ error: 'serialNumber and partNumber are required' });
  if (coll('serials').some(s => s.serialNumber === serialNumber)) return res.status(409).json({ error: 'Serial number already exists' });
  const unit = {
    id: newId('ser'), serialNumber, partNumber, partRevision: partRevision || 'A',
    batch: batch || '', buildDate: buildDate || new Date().toISOString().slice(0, 10),
    components: (components || []).map(c => ({
      componentPart: c.componentPart, serialOrLot: c.serialOrLot || '', supplier: c.supplier || '', millCertRef: c.millCertRef || ''
    })),
    status: 'In Production',
    recordedBy: req.user.name, createdAt: new Date().toISOString()
  };
  coll('serials').push(unit);
  save();
  trail.record(req.user, 'CREATE', 'serial', unit.id, `Serial ${serialNumber} (${partNumber} rev ${unit.partRevision}) with ${unit.components.length} traced component(s)`);
  res.status(201).json(unit);
});

router.put('/serials/:id', requireRole('quality'), (req, res) => {
  const unit = byId('serials', req.params.id);
  if (!unit) return res.status(404).json({ error: 'Serial record not found' });
  if (req.body.status && ['In Production', 'Released', 'Shipped', 'Quarantined', 'Scrapped'].includes(req.body.status)) {
    unit.status = req.body.status;
  }
  save();
  trail.record(req.user, 'UPDATE', 'serial', unit.id, `Serial ${unit.serialNumber} -> ${unit.status}`);
  res.json(unit);
});

// ============ Obsolescence (ISO 22163 / rail) ============
router.get('/obsolescence', (req, res) => {
  const today = Date.now();
  res.json(coll('obsolescence').map(o => {
    let alert = null;
    if (o.eolDate) {
      const days = Math.floor((new Date(o.eolDate) - today) / 86400000);
      if (days < 0) alert = 'EOL PASSED';
      else if (days < 365) alert = `EOL in ${days} days`;
      else if (days < 365 * 3) alert = `EOL in ${(days / 365).toFixed(1)} years`;
    }
    if (['Obsolete', 'EOL'].includes(o.lifecycle)) alert = alert || 'REDESIGN REQUIRED';
    return { ...o, alert };
  }));
});

router.post('/obsolescence', requireRole('quality'), (req, res) => {
  const { component, manufacturer, mpn, lifecycle, ltbDate, eolDate, usedIn, mitigation } = req.body || {};
  if (!component) return res.status(400).json({ error: 'component is required' });
  const item = {
    id: newId('obs'), component, manufacturer: manufacturer || '', mpn: mpn || '',
    lifecycle: ['Active', 'NRND', 'LTB', 'EOL', 'Obsolete'].includes(lifecycle) ? lifecycle : 'Active',
    ltbDate: ltbDate || null, eolDate: eolDate || null,
    usedIn: usedIn || [], mitigation: mitigation || '',
    createdBy: req.user.name, createdAt: new Date().toISOString()
  };
  coll('obsolescence').push(item);
  save();
  trail.record(req.user, 'CREATE', 'obsolescence', item.id, `Tracking ${component} (${item.lifecycle})`);
  res.status(201).json(item);
});

router.put('/obsolescence/:id', requireRole('quality'), (req, res) => {
  const item = byId('obsolescence', req.params.id);
  if (!item) return res.status(404).json({ error: 'Component not found' });
  const { lifecycle, ltbDate, eolDate, mitigation } = req.body || {};
  if (lifecycle && ['Active', 'NRND', 'LTB', 'EOL', 'Obsolete'].includes(lifecycle)) item.lifecycle = lifecycle;
  if (ltbDate !== undefined) item.ltbDate = ltbDate;
  if (eolDate !== undefined) item.eolDate = eolDate;
  if (mitigation !== undefined) item.mitigation = mitigation;
  save();
  trail.record(req.user, 'UPDATE', 'obsolescence', item.id, `${item.component}: lifecycle ${item.lifecycle}`);
  res.json(item);
});

// ============ Suppliers (incl. counterfeit-part avoidance) ============
router.get('/suppliers', (req, res) => res.json(coll('suppliers')));

router.post('/suppliers', requireRole('quality'), (req, res) => {
  const { name, category, certifications, authorizedDistributor, cocRequired, testReportsRequired } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name is required' });
  const checks = {
    authorizedDistributor: !!authorizedDistributor,
    cocRequired: cocRequired !== false,
    testReportsRequired: !!testReportsRequired
  };
  const riskScore = (checks.authorizedDistributor ? 0 : 40) + (checks.cocRequired ? 0 : 30) + (checks.testReportsRequired ? 0 : 10);
  const supplier = {
    id: newId('sup'), name, category: category || 'Component',
    certifications: certifications || [],
    counterfeitChecks: checks,
    riskScore, counterfeitRisk: riskScore >= 40 ? 'High' : riskScore >= 20 ? 'Medium' : 'Low',
    status: riskScore >= 40 ? 'Conditional' : 'Approved',
    createdBy: req.user.name, createdAt: new Date().toISOString()
  };
  coll('suppliers').push(supplier);
  save();
  trail.record(req.user, 'CREATE', 'supplier', supplier.id, `Supplier ${name} added (${supplier.status}, counterfeit risk ${supplier.counterfeitRisk})`);
  res.status(201).json(supplier);
});

router.put('/suppliers/:id', requireRole('quality'), (req, res) => {
  const s = byId('suppliers', req.params.id);
  if (!s) return res.status(404).json({ error: 'Supplier not found' });
  const { status, certifications, counterfeitChecks } = req.body || {};
  if (status && ['Approved', 'Conditional', 'Suspended'].includes(status)) s.status = status;
  if (certifications) s.certifications = certifications;
  if (counterfeitChecks) {
    s.counterfeitChecks = { ...s.counterfeitChecks, ...counterfeitChecks };
    s.riskScore = (s.counterfeitChecks.authorizedDistributor ? 0 : 40) + (s.counterfeitChecks.cocRequired ? 0 : 30) + (s.counterfeitChecks.testReportsRequired ? 0 : 10);
    s.counterfeitRisk = s.riskScore >= 40 ? 'High' : s.riskScore >= 20 ? 'Medium' : 'Low';
  }
  save();
  trail.record(req.user, 'UPDATE', 'supplier', s.id, `Supplier ${s.name}: status ${s.status}, risk ${s.counterfeitRisk}`);
  res.json(s);
});

module.exports = router;
