'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), override: true });

const express = require('express');
const cors    = require('cors');
const fs      = require('fs');
const path    = require('path');

const { analyzeClient }      = require('./agent');
const { handleBookingCheck } = require('./booking_check');

// ---------------------------------------------------------------------------
// Express setup
// ---------------------------------------------------------------------------

const app  = express();
const PORT = process.env.PORT || 3001;

app.use(express.json());

const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:3000',
  process.env.FRONTEND_URL,
  // Vercel sets VERCEL_URL per deployment and VERCEL_PROJECT_PRODUCTION_URL for the stable alias
  process.env.VERCEL_URL                    ? `https://${process.env.VERCEL_URL}`                    : null,
  process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : null,
].filter(Boolean);

app.use(cors({
  origin: (origin, cb) => {
    // Allow requests with no origin (curl, Postman, server-side)
    if (!origin) return cb(null, true);
    // Allow any *.vercel.app subdomain (all deployments of this project)
    if (allowedOrigins.includes(origin) || /^https:\/\/[a-z0-9-]+-ikolegov-1111s-projects\.vercel\.app$/.test(origin) || origin === 'https://ai-tax-advisor-mvp.vercel.app') {
      return cb(null, true);
    }
    cb(new Error(`CORS: origin ${origin} not allowed`));
  },
  methods: ['GET', 'POST']
}));

// ---------------------------------------------------------------------------
// GET /api/clients
// Returns list of all clients from clients.json
// ---------------------------------------------------------------------------

app.get('/api/clients', (req, res) => {
  try {
    const clients = JSON.parse(
      fs.readFileSync(path.join(__dirname, 'data', 'clients.json'), 'utf8')
    );
    res.json(clients);
  } catch (err) {
    res.status(500).json({ error: 'server_error', message: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/analyze
// Body: { clientId, period?, userQuery, threadId? }
// ---------------------------------------------------------------------------

app.post('/api/analyze', async (req, res) => {
  const { clientId, period, userQuery, threadId } = req.body ?? {};

  // Validation
  if (!clientId) {
    return res.status(400).json({
      error: 'missing_fields',
      message: 'clientId is required'
    });
  }
  if (!userQuery) {
    return res.status(400).json({
      error: 'missing_fields',
      message: 'userQuery is required'
    });
  }

  // Verify client exists
  try {
    const clients = JSON.parse(
      fs.readFileSync(path.join(__dirname, 'data', 'clients.json'), 'utf8')
    );
    if (!clients.find(c => c.id === clientId)) {
      return res.status(404).json({
        error: 'client_not_found',
        message: `No client found with id "${clientId}"`
      });
    }
  } catch {
    return res.status(500).json({ error: 'server_error', message: 'Could not read clients data' });
  }

  // Set a 90s timeout on the response
  const started = Date.now();
  console.log(`[server] analyze start — client=${clientId} period=${period ?? 'all'}`);

  const timeout = setTimeout(() => {
    if (!res.headersSent) {
      res.status(504).json({ error: 'agent_timeout', message: 'Agent did not respond within 300s' });
    }
  }, 300_000);

  try {
    const result = await analyzeClient(clientId, period ?? null, userQuery, threadId ?? null);
    clearTimeout(timeout);
    const elapsed = Math.round((Date.now() - started) / 1000);
    console.log(`[server] analyze done — ${elapsed}s, ${result.iterations} iterations`);
    if (!res.headersSent) {
      res.json({ threadId: result.threadId, report: result.report, raw_text: result.raw_text });
    }
  } catch (err) {
    clearTimeout(timeout);
    if (res.headersSent) return;

    if (err.message === 'agent_loop_limit_exceeded') {
      return res.status(500).json({ error: 'agent_loop_limit_exceeded', message: 'Agent loop exceeded 10 iterations' });
    }
    console.error('[server] agent error:', err.message);
    res.status(500).json({ error: 'agent_error', message: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/booking-check
// Body: { client_id, invoice_id?, transaction_id?, entry_id? }
// ---------------------------------------------------------------------------

app.post('/api/booking-check', async (req, res) => {
  await handleBookingCheck(req, res);
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

// Only start listening when run directly (not when imported by Vercel serverless)
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`[server] Running on http://localhost:${PORT}`);
    console.log(`[server] Endpoints: GET /api/clients  POST /api/analyze`);
  });
}

module.exports = app;
