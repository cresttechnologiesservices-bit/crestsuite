// Document Control: versioned repository with lifecycle
// Draft -> In Review -> Approved -> Effective -> Archived
// Updates create a new revision; approval requires an electronic signature.
const express = require('express');
const fs = require('fs');
const path = require('path');
const { coll, byId, newId, save, nextNumber, DATA_DIR } = require('../lib/db');
const { authRequired, requireRole, verifySignature } = require('../lib/auth');
const trail = require('../lib/audittrail');

const router = express.Router();
router.use(authRequired);

const DOC_TYPES = ['SOP', 'Work Instruction', 'Form', 'Policy', 'Quality Manual', 'Control Plan', 'Specification', 'Record'];
const DOC_CATEGORIES = ['ISO 9001', 'SDLC', 'Aerospace', 'Automotive', 'Industrial', 'IEC 62443', 'Others'];

function currentRev(doc) {
  return doc.revisions[doc.revisions.length - 1];
}

// Attachments arrive as data URLs from the SPA (10 MB raw limit) but are
// stored on disk under data/uploads/documents/ — only metadata + the file
// path live in the database.
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads', 'documents');

function validAttachment(att) {
  if (att === undefined || att === null) return { ok: true, value: undefined };
  if (typeof att !== 'object' || !att.name || typeof att.dataUrl !== 'string' || !att.dataUrl.startsWith('data:')) {
    return { ok: false, error: 'attachment must be { name, mime, dataUrl }' };
  }
  const base64 = att.dataUrl.split(',')[1] || '';
  const bytes = Math.floor(base64.length * 3 / 4);
  if (bytes > MAX_ATTACHMENT_BYTES) return { ok: false, error: 'Attachment exceeds the 10 MB limit' };
  return {
    ok: true,
    value: { name: String(att.name), mime: att.mime || 'application/octet-stream', size: bytes, dataUrl: att.dataUrl }
  };
}

// Persist a validated attachment to disk; returns the metadata to store in DB.
function storeAttachment(att, docNumber, rev) {
  if (!att) return att; // undefined passes through
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  const safeName = att.name.replace(/[^a-zA-Z0-9._ -]/g, '_').slice(0, 120);
  const fileName = `${docNumber}-rev${rev}-${Date.now().toString(36)}-${safeName}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, fileName), Buffer.from(att.dataUrl.split(',')[1] || '', 'base64'));
  return { name: att.name, mime: att.mime, size: att.size, file: fileName };
}

// Read an attachment's bytes whether stored on disk (new) or inline (legacy).
function attachmentBuffer(att) {
  if (att.file) return fs.readFileSync(path.join(UPLOAD_DIR, att.file));
  return Buffer.from((att.dataUrl || '').split(',')[1] || '', 'base64');
}

router.get('/', (req, res) => {
  const { status, type, q, category, standard } = req.query;
  let docs = coll('documents');
  // Employees do not see archived documents by default
  if (status) docs = docs.filter(d => d.status === status);
  else if (req.user.role === 'employee') docs = docs.filter(d => d.status !== 'Archived');
  if (type) docs = docs.filter(d => d.type === type);
  if (category) docs = docs.filter(d => (d.category || 'Others') === category);
  if (standard) {
    const s = standard.toLowerCase();
    docs = docs.filter(d => (d.standards || []).some(x => x.toLowerCase().includes(s)));
  }
  if (q) {
    const s = q.toLowerCase();
    docs = docs.filter(d => d.title.toLowerCase().includes(s) || d.docNumber.toLowerCase().includes(s));
  }
  res.json(docs.map(d => ({
    id: d.id, docNumber: d.docNumber, title: d.title, type: d.type, standards: d.standards,
    category: d.category || 'Others',
    department: d.department, status: d.status, trainingRequired: d.trainingRequired,
    rev: currentRev(d).rev, updatedAt: currentRev(d).createdAt, revisionCount: d.revisions.length
  })));
});

router.get('/:id', (req, res) => {
  const doc = byId('documents', req.params.id);
  if (!doc) return res.status(404).json({ error: 'Document not found' });
  if (doc.status === 'Archived' && req.user.role === 'employee') {
    return res.status(403).json({ error: 'Archived documents are restricted to quality/admin roles' });
  }
  res.json(doc);
});

router.post('/', requireRole('quality'), (req, res) => {
  const { title, type, standards, department, content, changeSummary, trainingRequired, category, attachment } = req.body || {};
  if (!title || !type) return res.status(400).json({ error: 'title and type are required' });
  if (!DOC_TYPES.includes(type)) return res.status(400).json({ error: `type must be one of: ${DOC_TYPES.join(', ')}` });
  const att = validAttachment(attachment);
  if (!att.ok) return res.status(400).json({ error: att.error });
  // Titles must be unique for unambiguous identification and search
  if (coll('documents').some(d => d.title.toLowerCase() === title.toLowerCase())) {
    return res.status(409).json({ error: `A document titled "${title}" already exists — choose a unique title` });
  }
  const doc = {
    id: newId('doc'),
    docNumber: nextNumber('DOC', 'QMS-DOC'),
    title, type,
    category: DOC_CATEGORIES.includes(category) ? category : 'Others',
    standards: standards || [],
    department: department || '',
    status: 'Draft',
    trainingRequired: !!trainingRequired,
    createdBy: req.user.name,
    createdAt: new Date().toISOString(),
    revisions: [{
      rev: 'A', content: content || '', changeSummary: changeSummary || 'Initial release',
      createdBy: req.user.name, createdAt: new Date().toISOString(), status: 'Draft', approvals: []
    }]
  };
  doc.revisions[0].attachment = storeAttachment(att.value, doc.docNumber, 'A');
  coll('documents').push(doc);
  save();
  trail.record(req.user, 'CREATE', 'document', doc.id, `Created ${doc.docNumber} "${title}" rev A (Draft)`);
  res.status(201).json(doc);
});

// Update document: creates a NEW revision (B, C, ...) and returns doc to Draft
router.post('/:id/revise', requireRole('quality'), (req, res) => {
  const doc = byId('documents', req.params.id);
  if (!doc) return res.status(404).json({ error: 'Document not found' });
  if (doc.status === 'Archived') return res.status(400).json({ error: 'Archived documents cannot be revised. Restore it first.' });
  const { content, changeSummary, attachment } = req.body || {};
  if (!changeSummary) return res.status(400).json({ error: 'A change summary is required for revisions' });
  const att = validAttachment(attachment);
  if (!att.ok) return res.status(400).json({ error: att.error });
  const prev = currentRev(doc);
  const nextRevLetter = String.fromCharCode(prev.rev.charCodeAt(0) + 1);
  doc.revisions.push({
    rev: nextRevLetter, content: content !== undefined ? content : prev.content,
    changeSummary, createdBy: req.user.name, createdAt: new Date().toISOString(),
    status: 'Draft', approvals: [],
    attachment: att.value !== undefined ? storeAttachment(att.value, doc.docNumber, nextRevLetter) : prev.attachment
  });
  doc.status = 'Draft';
  save();
  trail.record(req.user, 'REVISE', 'document', doc.id, `${doc.docNumber} revised to rev ${nextRevLetter}: ${changeSummary}`);
  res.json(doc);
});

// Edit draft content in place (only while Draft)
router.put('/:id/draft', requireRole('quality'), (req, res) => {
  const doc = byId('documents', req.params.id);
  if (!doc) return res.status(404).json({ error: 'Document not found' });
  if (doc.status !== 'Draft') return res.status(400).json({ error: 'Only Draft documents can be edited. Use Revise to update a released document.' });
  const rev = currentRev(doc);
  const { title, content, changeSummary, department, standards, trainingRequired, category, attachment } = req.body || {};
  const att = validAttachment(attachment);
  if (!att.ok) return res.status(400).json({ error: att.error });
  if (att.value !== undefined) rev.attachment = storeAttachment(att.value, doc.docNumber, rev.rev);
  if (title && title.toLowerCase() !== doc.title.toLowerCase()
      && coll('documents').some(x => x.id !== doc.id && x.title.toLowerCase() === title.toLowerCase())) {
    return res.status(409).json({ error: `A document titled "${title}" already exists — choose a unique title` });
  }
  if (title) doc.title = title;
  if (department !== undefined) doc.department = department;
  if (standards) doc.standards = standards;
  if (category && DOC_CATEGORIES.includes(category)) doc.category = category;
  if (trainingRequired !== undefined) doc.trainingRequired = !!trainingRequired;
  if (content !== undefined) rev.content = content;
  if (changeSummary) rev.changeSummary = changeSummary;
  save();
  trail.record(req.user, 'UPDATE', 'document', doc.id, `Edited draft ${doc.docNumber} rev ${rev.rev}`);
  res.json(doc);
});

// Download a revision's attached file
router.get('/:id/attachment/:rev', (req, res) => {
  const doc = byId('documents', req.params.id);
  if (!doc) return res.status(404).json({ error: 'Document not found' });
  if (doc.status === 'Archived' && req.user.role === 'employee') {
    return res.status(403).json({ error: 'Archived documents are restricted to quality/admin roles' });
  }
  const rev = doc.revisions.find(r => r.rev === req.params.rev);
  if (!rev || !rev.attachment) return res.status(404).json({ error: 'No attachment on that revision' });
  let buf;
  try {
    buf = attachmentBuffer(rev.attachment);
  } catch (e) {
    return res.status(404).json({ error: 'Attachment file is missing from the uploads directory' });
  }
  res.setHeader('Content-Type', rev.attachment.mime);
  res.setHeader('Content-Disposition', `attachment; filename="${rev.attachment.name.replace(/"/g, '')}"`);
  res.send(buf);
});

router.post('/:id/submit-review', requireRole('quality'), (req, res) => {
  const doc = byId('documents', req.params.id);
  if (!doc) return res.status(404).json({ error: 'Document not found' });
  if (doc.status !== 'Draft') return res.status(400).json({ error: 'Only Draft documents can be submitted for review' });
  doc.status = 'In Review';
  currentRev(doc).status = 'In Review';
  save();
  trail.record(req.user, 'SUBMIT', 'document', doc.id, `${doc.docNumber} rev ${currentRev(doc).rev} submitted for review`);
  res.json(doc);
});

// Approve with electronic signature (password re-entry)
router.post('/:id/approve', requireRole('quality'), (req, res) => {
  const doc = byId('documents', req.params.id);
  if (!doc) return res.status(404).json({ error: 'Document not found' });
  if (doc.status !== 'In Review') return res.status(400).json({ error: 'Only documents In Review can be approved' });
  const sig = verifySignature(req);
  if (!sig.ok) return res.status(400).json({ error: sig.error });
  const rev = currentRev(doc);
  if (rev.approvals.some(a => a.userId === req.user.id)) {
    return res.status(400).json({ error: 'You have already signed this revision' });
  }
  rev.approvals.push({ ...sig.signature, meaning: req.body.meaning || 'Approved' });
  // Two signatures (or one admin) releases the document to Effective
  const hasAdmin = rev.approvals.some(a => {
    const u = coll('users').find(x => x.id === a.userId);
    return u && u.role === 'admin';
  });
  if (rev.approvals.length >= 2 || hasAdmin) {
    doc.status = 'Effective';
    rev.status = 'Effective';
    rev.effectiveAt = new Date().toISOString();
    // Auto-assign retraining to all active employees if the doc requires training
    if (doc.trainingRequired) {
      const users = coll('users').filter(u => u.active && u.role !== 'admin');
      for (const u of users) {
        coll('trainings').push({
          id: newId('trn'), userId: u.id, userName: u.name,
          docId: doc.id, docNumber: doc.docNumber,
          title: `Read & Understand: ${doc.docNumber} rev ${rev.rev} — ${doc.title}`,
          type: 'Document Acknowledgment', status: 'Assigned',
          dueDate: new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10),
          assignedAt: new Date().toISOString(), completedAt: null, acknowledgment: null
        });
      }
      trail.record(req.user, 'ASSIGN_TRAINING', 'document', doc.id, `Auto-assigned acknowledgment training for ${doc.docNumber} rev ${rev.rev} to ${users.length} users`);
    }
  } else {
    doc.status = 'Approved';
    rev.status = 'Approved';
  }
  save();
  trail.record(req.user, 'SIGN', 'document', doc.id, `E-signature on ${doc.docNumber} rev ${rev.rev} (${req.body.meaning || 'Approved'}) — status now ${doc.status}`);
  res.json(doc);
});

router.post('/:id/reject', requireRole('quality'), (req, res) => {
  const doc = byId('documents', req.params.id);
  if (!doc) return res.status(404).json({ error: 'Document not found' });
  if (!['In Review', 'Approved'].includes(doc.status)) return res.status(400).json({ error: 'Only documents In Review can be rejected' });
  doc.status = 'Draft';
  const rev = currentRev(doc);
  rev.status = 'Draft';
  rev.approvals = [];
  save();
  trail.record(req.user, 'REJECT', 'document', doc.id, `${doc.docNumber} rev ${rev.rev} rejected back to Draft: ${req.body.reason || 'no reason given'}`);
  res.json(doc);
});

// Archive (with e-signature) and restore
router.post('/:id/archive', requireRole('quality'), (req, res) => {
  const doc = byId('documents', req.params.id);
  if (!doc) return res.status(404).json({ error: 'Document not found' });
  if (doc.status === 'Archived') return res.status(400).json({ error: 'Document is already archived' });
  const sig = verifySignature(req);
  if (!sig.ok) return res.status(400).json({ error: sig.error });
  doc.prevStatus = doc.status;
  doc.status = 'Archived';
  doc.archivedAt = new Date().toISOString();
  doc.archivedBy = req.user.name;
  doc.archiveReason = req.body.reason || '';
  save();
  trail.record(req.user, 'ARCHIVE', 'document', doc.id, `${doc.docNumber} archived: ${doc.archiveReason || 'no reason given'}`);
  res.json(doc);
});

router.post('/:id/restore', requireRole('admin'), (req, res) => {
  const doc = byId('documents', req.params.id);
  if (!doc) return res.status(404).json({ error: 'Document not found' });
  if (doc.status !== 'Archived') return res.status(400).json({ error: 'Document is not archived' });
  doc.status = doc.prevStatus || 'Draft';
  delete doc.prevStatus;
  doc.archivedAt = null;
  doc.archivedBy = null;
  save();
  trail.record(req.user, 'RESTORE', 'document', doc.id, `${doc.docNumber} restored from archive to ${doc.status}`);
  res.json(doc);
});

module.exports = router;
