// Audit management: internal / external / supplier audits and Layered
// Process Audits (LPA). Checklist execution, findings, and CAPA linkage.
const express = require('express');
const { coll, byId, newId, save, nextNumber } = require('../lib/db');
const { authRequired, requireRole } = require('../lib/auth');
const trail = require('../lib/audittrail');

const router = express.Router();
router.use(authRequired);

router.get('/', (req, res) => {
  const { status, type } = req.query;
  let audits = coll('audits');
  if (status) audits = audits.filter(a => a.status === status);
  if (type) audits = audits.filter(a => a.type === type);
  res.json(audits.map(a => ({
    id: a.id, auditNumber: a.auditNumber, title: a.title, type: a.type, layer: a.layer,
    standard: a.standard, auditor: a.auditor, auditee: a.auditee, scheduledDate: a.scheduledDate,
    status: a.status, findingCount: (a.findings || []).length,
    ncCount: (a.findings || []).filter(f => f.classification !== 'Observation').length
  })));
});

router.get('/:id', (req, res) => {
  const audit = byId('audits', req.params.id);
  if (!audit) return res.status(404).json({ error: 'Audit not found' });
  res.json(audit);
});

router.post('/', requireRole('quality'), (req, res) => {
  const { title, type, layer, standard, scope, auditor, auditee, scheduledDate, checklist } = req.body || {};
  if (!title || !scheduledDate) return res.status(400).json({ error: 'title and scheduledDate are required' });
  const audit = {
    id: newId('aud'),
    auditNumber: nextNumber('AUD', 'AUD'),
    title,
    type: type || 'Internal',       // Internal | External | Supplier | LPA
    layer: type === 'LPA' ? (layer || 'Supervisor') : null,  // Operator | Supervisor | Manager | Executive
    standard: standard || 'ISO 9001:2015',
    scope: scope || '',
    auditor: auditor || req.user.name,
    auditee: auditee || '',
    scheduledDate,
    status: 'Planned',
    checklist: (checklist || []).map(item => ({
      id: newId('chk'), item: typeof item === 'string' ? item : item.item,
      clause: item.clause || '', result: null, notes: ''
    })),
    findings: [],
    summary: '',
    completedAt: null,
    createdBy: req.user.name,
    createdAt: new Date().toISOString()
  };
  coll('audits').push(audit);
  save();
  trail.record(req.user, 'CREATE', 'audit', audit.id, `Scheduled ${audit.auditNumber} "${title}" (${audit.type}${audit.layer ? ' / ' + audit.layer : ''}) for ${scheduledDate}`);
  res.status(201).json(audit);
});

router.post('/:id/start', requireRole('quality'), (req, res) => {
  const audit = byId('audits', req.params.id);
  if (!audit) return res.status(404).json({ error: 'Audit not found' });
  if (audit.status !== 'Planned') return res.status(400).json({ error: 'Only planned audits can be started' });
  audit.status = 'In Progress';
  save();
  trail.record(req.user, 'UPDATE', 'audit', audit.id, `${audit.auditNumber} started`);
  res.json(audit);
});

// Record checklist results (auditor executes checklist)
router.put('/:id/checklist/:itemId', requireRole('quality'), (req, res) => {
  const audit = byId('audits', req.params.id);
  if (!audit) return res.status(404).json({ error: 'Audit not found' });
  const item = audit.checklist.find(c => c.id === req.params.itemId);
  if (!item) return res.status(404).json({ error: 'Checklist item not found' });
  const { result, notes } = req.body || {};
  if (result && !['Confirm', 'Nonconfirm', 'Observation', 'N/A'].includes(result)) {
    return res.status(400).json({ error: 'result must be Confirm, Nonconfirm, Observation or N/A' });
  }
  if (result) item.result = result;
  if (notes !== undefined) item.notes = notes;
  save();
  trail.record(req.user, 'UPDATE', 'audit', audit.id, `${audit.auditNumber} checklist "${item.item}": ${item.result || 'noted'}`);
  res.json(audit);
});

router.post('/:id/checklist', requireRole('quality'), (req, res) => {
  const audit = byId('audits', req.params.id);
  if (!audit) return res.status(404).json({ error: 'Audit not found' });
  const { item, clause } = req.body || {};
  if (!item) return res.status(400).json({ error: 'item text is required' });
  audit.checklist.push({ id: newId('chk'), item, clause: clause || '', result: null, notes: '' });
  save();
  res.json(audit);
});

// Findings; a Nonconformance finding can spawn a linked CAPA automatically
router.post('/:id/findings', requireRole('quality'), (req, res) => {
  const audit = byId('audits', req.params.id);
  if (!audit) return res.status(404).json({ error: 'Audit not found' });
  const { description, classification, clause, raiseCapa } = req.body || {};
  if (!description) return res.status(400).json({ error: 'description is required' });
  const cls = ['Major NC', 'Minor NC', 'Observation'].includes(classification) ? classification : 'Observation';
  const finding = { id: newId('fnd'), description, classification: cls, clause: clause || '', capaId: null, capaNumber: null, createdAt: new Date().toISOString() };
  if (raiseCapa && cls !== 'Observation') {
    const capaNumber = nextNumber('CAPA', 'CAPA');
    const capa = {
      id: newId('capa'), capaNumber,
      title: `Audit finding: ${description.slice(0, 80)}`,
      description: `Raised from ${audit.auditNumber} (${audit.title})${clause ? ', clause ' + clause : ''}: ${description}`,
      type: 'corrective', source: `Audit ${audit.auditNumber}`,
      severity: cls === 'Major NC' ? 'Major' : 'Minor',
      status: 'Open', owner: audit.auditee || req.user.name,
      dueDate: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
      linkedAuditId: audit.id, linkedDocId: null,
      raisedBy: req.user.name, createdAt: new Date().toISOString(),
      eightD: Object.fromEntries(['d1','d2','d3','d4','d5','d6','d7','d8'].map((k, i) => [k, {
        name: `D${i+1}`, content: '', complete: false, completedBy: null, completedAt: null
      }])),
      fiveWhys: [], fishbone: { man: '', machine: '', method: '', material: '', measurement: '', environment: '' },
      rootCause: '', actions: [], verification: null, closedAt: null, closedBy: null
    };
    coll('capas').push(capa);
    finding.capaId = capa.id;
    finding.capaNumber = capaNumber;
    trail.record(req.user, 'CREATE', 'capa', capa.id, `${capaNumber} auto-raised from audit finding in ${audit.auditNumber}`);
  }
  audit.findings.push(finding);
  save();
  trail.record(req.user, 'FINDING', 'audit', audit.id, `${audit.auditNumber}: ${cls} — ${description}`);
  res.json(audit);
});

router.post('/:id/complete', requireRole('quality'), (req, res) => {
  const audit = byId('audits', req.params.id);
  if (!audit) return res.status(404).json({ error: 'Audit not found' });
  if (audit.status !== 'In Progress') return res.status(400).json({ error: 'Only audits In Progress can be completed' });
  const unanswered = audit.checklist.filter(c => !c.result);
  if (unanswered.length) return res.status(400).json({ error: `${unanswered.length} checklist item(s) unanswered` });
  audit.status = 'Complete';
  audit.summary = req.body.summary || '';
  audit.completedAt = new Date().toISOString();
  save();
  trail.record(req.user, 'COMPLETE', 'audit', audit.id, `${audit.auditNumber} completed: ${audit.findings.length} finding(s)`);
  res.json(audit);
});

module.exports = router;
