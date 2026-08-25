const express = require('express');
const path = require('path');
const { load } = require('./lib/db');
const { ensureSeed } = require('./lib/seed');

const app = express();
app.use(express.json({ limit: '20mb' })); // allows 10 MB document attachments (base64-encoded)
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/auth', require('./routes/auth'));
app.use('/api/documents', require('./routes/documents'));
app.use('/api/capas', require('./routes/capa'));
app.use('/api/audits', require('./routes/audits'));
app.use('/api/trainings', require('./routes/training'));
app.use('/api/mfg', require('./routes/mfg'));
app.use('/api/system', require('./routes/system'));

app.use('/api', (req, res) => res.status(404).json({ error: 'Unknown API endpoint' }));

// SPA fallback
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// Central error handler so stack traces never leak to clients
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 5601;

if (require.main === module) {
  (async () => {
    await require('./lib/db').init();
    load();
    ensureSeed();
    app.listen(PORT, () => console.log(`QMS Suite running at http://localhost:${PORT}`));
  })().catch((err) => { console.error(err); process.exit(1); });
}

module.exports = app;
