// CAPA management with 8D problem-solving workflow, 5-Why root cause,
// action tracking and verification of effectiveness.
const express = require('express');
const { coll, byId, newId, save, nextNumber } = require('../lib/db');
const { authRequired, requireRole, verifySignature } = require('../lib/auth');
const trail = require('../lib/audittrail');

const router = express.Router();
router.use(authRequired);

const D_STEPS = [
  { key: 'd1', name: 'D1 — Team Formation' },
  { key: 'd2', name: 'D2 — Problem Description' },
  { key: 'd3', name: 'D3 — Interim Containment' },
  { key: 'd4', name: 'D4 — Root Cause Analysis' },
  { key: 'd5', name: 'D5 — Permanent Corrective Actions' },
  { key: 'd6', name: 'D6 — Implement & Validate' },
  { key: 'd7', name: 'D7 — Prevent Recurrence' },
  { key: 'd8', name: 'D8 — Team Recognition & Closure' }
];

router.get('/', (req, res) => {
  const { status, type } = req.query;
  let capas = coll('capas');
  if (status) capas = capas.filter(c => c.status === status);
  if (type) capas = capas.filter(c => c.type === type);
  res.json(capas.map(c => ({
    id: c.id, capaNumber: c.capaNumber, title: c.title, type: c.type, source: c.source,
    severity: c.severity, status: c.status, owner: c.owner, dueDate: c.dueDate,
    createdAt: c.createdAt, openActions: (c.actions || []).filter(a => !a.done).length
  })));
});

router.get('/:id', (req, res) => {
  const capa = byId('capas', req.params.id);
  if (!capa) return res.status(404).json({ error: 'CAPA not found' });
  res.json(capa);
});

// Any authenticated employee may raise a CAPA / nonconformance
router.post('/', (req, res) => {
  const { title, type, source, severity, description, owner, dueDate, linkedAuditId, linkedDocId } = req.body || {};
  if (!title || !description) return res.status(400).json({ error: 'title and description are required' });
  const capa = {
    id: newId('capa'),
    capaNumber: nextNumber('CAPA', 'CAPA'),
    title, description,
    type: type === 'preventive' ? 'preventive' : 'corrective',
    source: source || 'Internal',
    severity: severity || 'Minor',
    status: 'Open',
    owner: owner || req.user.name,
    dueDate: dueDate || new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
    linkedAuditId: linkedAuditId || null,
    linkedDocId: linkedDocId || null,
    raisedBy: req.user.name,
    createdAt: new Date().toISOString(),
    eightD: Object.fromEntries(D_STEPS.map(s => [s.key, { name: s.name, content: '', complete: false, completedBy: null, completedAt: null }])),
    fiveWhys: [],
    fishbone: { man: '', machine: '', method: '', material: '', measurement: '', environment: '' },
    rootCause: '',
    actions: [],
    verification: null,
    closedAt: null, closedBy: null
  };
  coll('capas').push(capa);
  save();
  trail.record(req.user, 'CREATE', 'capa', capa.id, `Raised ${capa.capaNumber} "${title}" (${capa.type}, ${capa.severity})`);
  res.status(201).json(capa);
});

// Update 8D step, root cause tools, general fields
router.put('/:id', requireRole('quality'), (req, res) => {
  const capa = byId('capas', req.params.id);
  if (!capa) return res.status(404).json({ error: 'CAPA not found' });
  if (capa.status === 'Closed') return res.status(400).json({ error: 'Closed CAPAs cannot be modified' });
  const { eightDStep, content, complete, fiveWhys, fishbone, rootCause, owner, dueDate, severity, status } = req.body || {};
  const changes = [];
  if (eightDStep && capa.eightD[eightDStep]) {
    const step = capa.eightD[eightDStep];
    if (content !== undefined) step.content = content;
    if (complete !== undefined) {
      step.complete = !!complete;
      step.completedBy = complete ? req.user.name : null;
      step.completedAt = complete ? new Date().toISOString() : null;
    }
    changes.push(`${step.name} updated`);
  }
  if (fiveWhys) { capa.fiveWhys = fiveWhys; changes.push('5-Why analysis updated'); }
  if (fishbone) { capa.fishbone = { ...capa.fishbone, ...fishbone }; changes.push('Fishbone updated'); }
  if (rootCause !== undefined) { capa.rootCause = rootCause; changes.push('Root cause updated'); }
  if (owner) { capa.owner = owner; changes.push(`owner -> ${owner}`); }
  if (dueDate) { capa.dueDate = dueDate; changes.push(`due -> ${dueDate}`); }
  if (severity) { capa.severity = severity; changes.push(`severity -> ${severity}`); }
  if (status && ['Open', 'Containment', 'Root Cause', 'Action', 'Verification'].includes(status)) {
    capa.status = status; changes.push(`status -> ${status}`);
  }
  save();
  trail.record(req.user, 'UPDATE', 'capa', capa.id, `${capa.capaNumber}: ${changes.join('; ') || 'updated'}`);
  res.json(capa);
});

// Action items
router.post('/:id/actions', requireRole('quality'), (req, res) => {
  const capa = byId('capas', req.params.id);
  if (!capa) return res.status(404).json({ error: 'CAPA not found' });
  const { description, owner, dueDate, kind } = req.body || {};
  if (!description) return res.status(400).json({ error: 'description is required' });
  const action = { id: newId('act'), description, owner: owner || capa.owner, dueDate: dueDate || capa.dueDate, kind: kind || 'corrective', done: false, doneAt: null, doneBy: null };
  capa.actions.push(action);
  save();
  trail.record(req.user, 'UPDATE', 'capa', capa.id, `${capa.capaNumber}: action added — ${description}`);
  res.json(capa);
});

router.put('/:id/actions/:actionId', (req, res) => {
  const capa = byId('capas', req.params.id);
  if (!capa) return res.status(404).json({ error: 'CAPA not found' });
  const action = capa.actions.find(a => a.id === req.params.actionId);
  if (!action) return res.status(404).json({ error: 'Action not found' });
  if (req.body.done !== undefined) {
    action.done = !!req.body.done;
    action.doneAt = action.done ? new Date().toISOString() : null;
    action.doneBy = action.done ? req.user.name : null;
  }
  save();
  trail.record(req.user, 'UPDATE', 'capa', capa.id, `${capa.capaNumber}: action "${action.description}" marked ${action.done ? 'complete' : 'reopened'}`);
  res.json(capa);
});

// Verification & closure requires e-signature and all 8D steps + actions complete
router.post('/:id/verify-close', requireRole('quality'), (req, res) => {
  const capa = byId('capas', req.params.id);
  if (!capa) return res.status(404).json({ error: 'CAPA not found' });
  if (capa.status === 'Closed') return res.status(400).json({ error: 'CAPA is already closed' });
  const openActions = capa.actions.filter(a => !a.done);
  if (openActions.length) return res.status(400).json({ error: `${openActions.length} action(s) still open — complete them before closure` });
  const incompleteD = Object.values(capa.eightD).filter(s => !s.complete);
  if (incompleteD.length) return res.status(400).json({ error: `8D steps incomplete: ${incompleteD.map(s => s.name.split(' — ')[0]).join(', ')}` });
  const sig = verifySignature(req);
  if (!sig.ok) return res.status(400).json({ error: sig.error });
  const { method, result, effective } = req.body || {};
  if (!method || !result) return res.status(400).json({ error: 'Verification method and result are required' });
  capa.verification = { method, result, effective: !!effective, ...sig.signature };
  capa.status = 'Closed';
  capa.closedAt = new Date().toISOString();
  capa.closedBy = req.user.name;
  save();
  trail.record(req.user, 'CLOSE', 'capa', capa.id, `${capa.capaNumber} verified (${effective ? 'effective' : 'not effective'}) and closed with e-signature`);
  res.json(capa);
});

module.exports = router;
