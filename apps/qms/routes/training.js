// Training management: assignments, competency tracking, and document
// acknowledgments (linked to SOP revisions) with e-signature.
const express = require('express');
const { coll, byId, newId, save } = require('../lib/db');
const { authRequired, requireRole, verifySignature } = require('../lib/auth');
const trail = require('../lib/audittrail');

const router = express.Router();
router.use(authRequired);

router.get('/', (req, res) => {
  let items = coll('trainings');
  // Employees see only their own records; quality/admin see all (or filter by user)
  if (req.user.role === 'employee') items = items.filter(t => t.userId === req.user.id);
  else if (req.query.userId) items = items.filter(t => t.userId === req.query.userId);
  if (req.query.status) items = items.filter(t => t.status === req.query.status);
  res.json(items);
});

router.get('/matrix', requireRole('quality'), (req, res) => {
  // Competency matrix: per-user counts of assigned/completed/overdue
  const today = new Date().toISOString().slice(0, 10);
  const users = coll('users').filter(u => u.active);
  const matrix = users.map(u => {
    const recs = coll('trainings').filter(t => t.userId === u.id);
    return {
      userId: u.id, name: u.name, role: u.role, department: u.department,
      assigned: recs.filter(t => t.status === 'Assigned').length,
      completed: recs.filter(t => t.status === 'Completed').length,
      overdue: recs.filter(t => t.status === 'Assigned' && t.dueDate && t.dueDate < today).length
    };
  });
  res.json(matrix);
});

router.post('/', requireRole('quality'), (req, res) => {
  const { userId, title, type, docId, dueDate } = req.body || {};
  if (!userId || !title) return res.status(400).json({ error: 'userId and title are required' });
  const user = byId('users', userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  let docNumber = null;
  if (docId) {
    const doc = byId('documents', docId);
    if (doc) docNumber = doc.docNumber;
  }
  const rec = {
    id: newId('trn'), userId, userName: user.name,
    docId: docId || null, docNumber,
    title, type: type || 'Classroom', status: 'Assigned',
    dueDate: dueDate || new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
    assignedAt: new Date().toISOString(), completedAt: null, acknowledgment: null
  };
  coll('trainings').push(rec);
  save();
  trail.record(req.user, 'CREATE', 'training', rec.id, `Assigned "${title}" to ${user.name}, due ${rec.dueDate}`);
  res.status(201).json(rec);
});

// Complete training with acknowledgment e-signature ("read & understood")
router.post('/:id/complete', (req, res) => {
  const rec = byId('trainings', req.params.id);
  if (!rec) return res.status(404).json({ error: 'Training record not found' });
  if (rec.userId !== req.user.id && req.user.role === 'employee') {
    return res.status(403).json({ error: 'You can only complete your own training' });
  }
  if (rec.status === 'Completed') return res.status(400).json({ error: 'Training already completed' });
  const sig = verifySignature(req);
  if (!sig.ok) return res.status(400).json({ error: sig.error });
  rec.status = 'Completed';
  rec.completedAt = new Date().toISOString();
  rec.acknowledgment = { ...sig.signature, statement: 'I have read and understood this material and will comply with it.' };
  if (req.body.score !== undefined) rec.score = req.body.score;
  save();
  trail.record(req.user, 'SIGN', 'training', rec.id, `Training "${rec.title}" completed & acknowledged by ${req.user.name}`);
  res.json(rec);
});

module.exports = router;
