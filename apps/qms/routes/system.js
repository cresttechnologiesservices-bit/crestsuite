// Dashboard KPIs, audit-trail viewer, and validation (IQ/OQ/PQ) documents.
const express = require('express');
const fs = require('fs');
const path = require('path');
const { coll } = require('../lib/db');
const { authRequired, requireRole } = require('../lib/auth');
const trail = require('../lib/audittrail');

const router = express.Router();
router.use(authRequired);

router.get('/dashboard', (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const docs = coll('documents');
  const capas = coll('capas');
  const audits = coll('audits');
  const trainings = coll('trainings');
  const obs = coll('obsolescence');
  const myTraining = trainings.filter(t => t.userId === req.user.id && t.status === 'Assigned');
  res.json({
    documents: {
      total: docs.length,
      effective: docs.filter(d => d.status === 'Effective').length,
      inReview: docs.filter(d => d.status === 'In Review').length,
      draft: docs.filter(d => d.status === 'Draft').length,
      archived: docs.filter(d => d.status === 'Archived').length
    },
    capas: {
      total: capas.length,
      open: capas.filter(c => c.status !== 'Closed').length,
      overdue: capas.filter(c => c.status !== 'Closed' && c.dueDate < today).length,
      closed: capas.filter(c => c.status === 'Closed').length
    },
    audits: {
      total: audits.length,
      planned: audits.filter(a => a.status === 'Planned').length,
      inProgress: audits.filter(a => a.status === 'In Progress').length,
      completed: audits.filter(a => a.status === 'Complete').length,
      openFindings: audits.reduce((n, a) => n + (a.findings || []).filter(f => f.classification !== 'Observation' && !f.capaId).length, 0)
    },
    training: {
      assigned: trainings.filter(t => t.status === 'Assigned').length,
      overdue: trainings.filter(t => t.status === 'Assigned' && t.dueDate < today).length,
      myPending: myTraining.length
    },
    obsolescence: {
      atRisk: obs.filter(o => ['NRND', 'LTB', 'EOL', 'Obsolete'].includes(o.lifecycle)).length
    },
    apqp: { active: coll('apqp').filter(p => p.status === 'Active').length },
    ppap: { inProgress: coll('ppap').filter(p => ['In Progress', 'Submitted'].includes(p.status)).length }
  });
});

// Audit trail — read-only, admin & quality
router.get('/trail', requireRole('quality'), (req, res) => {
  const { entity, entityId, userId, limit } = req.query;
  let entries = trail.readAll({ entity, entityId, userId });
  res.json(entries.slice(0, Number(limit) || 200));
});

router.get('/trail/verify', requireRole('admin'), (req, res) => {
  res.json(trail.verifyChain());
});

// Per-record history (any authenticated user can see history of records they can access)
router.get('/trail/record/:entity/:entityId', (req, res) => {
  res.json(trail.readAll({ entity: req.params.entity, entityId: req.params.entityId }));
});

// Validation documents (IQ/OQ/PQ)
router.get('/validation', (req, res) => {
  const dir = path.join(__dirname, '..', 'validation');
  if (!fs.existsSync(dir)) return res.json([]);
  res.json(fs.readdirSync(dir).filter(f => f.endsWith('.md')).map(f => ({
    file: f, name: f.replace('.md', '').replace(/-/g, ' ')
  })));
});

router.get('/validation/:file', (req, res) => {
  const file = req.params.file.replace(/[^a-zA-Z0-9-_.]/g, '');
  const p = path.join(__dirname, '..', 'validation', file);
  if (!fs.existsSync(p)) return res.status(404).json({ error: 'Not found' });
  res.json({ file, content: fs.readFileSync(p, 'utf8') });
});

module.exports = router;
