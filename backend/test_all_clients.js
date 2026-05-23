'use strict';

/**
 * Phase 6 — Final Validation Runner
 *
 * Runs all 7 test clients through the agent and checks that expected
 * error/warning IDs are present in the output.
 *
 * Usage:  node backend/test_all_clients.js
 * Output: prints a pass/fail table + saves backend/test_results.json
 *
 * Runs sequentially to avoid hitting API rate limits.
 * Does NOT make HTTP requests — calls analyzeClient() directly.
 * Estimated cost: ~$10–12 total (one-time QA run).
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs   = require('fs');
const path = require('path');
const { analyzeClient } = require('./agent');

// ---------------------------------------------------------------------------
// Test matrix — expected IDs that MUST appear in errors[] or warnings[]
// ---------------------------------------------------------------------------

const CLIENTS = [
  {
    id:       'client_001',
    name:     'Anna Müller — IT-Freelancer',
    period:   'Full Year 2026',  // Error is in April 2026 — outside Q1
    query:    'Check my books for errors, especially EU invoices',
    expected: ['A-12'],          // entry_001_009: RC flag=false for IE supplier (OpenAI)
  },
  {
    id:       'client_002',
    name:     'Thomas Schneider — Grafikdesigner',
    period:   'Full Year 2025',
    query:    'Überprüfe meine Buchhaltung auf Fehler und Unstimmigkeiten',
    expected: ['B-04'],          // Büroreinigung (6330) + Home Office Tagespauschale double deduction
  },
  {
    id:       'client_003',
    name:     'Maria Schmidt — Online-Shop / Amazon FBA',
    period:   'Q1 2026',
    query:    'Check my Q1 books — I had a refund and marketplace fees',
    expected: ['A-11', 'A-10'],  // A-11: Amazon commission not posted; A-10: refund not marked
  },
  {
    id:       'client_004',
    name:     'Peter Wagner — Unternehmensberater',
    period:   'Q1 2026',
    query:    'Check my Q1 EU invoices and company car bookings',
    expected: ['A-12', 'B-Type-01'], // A-12: PL supplier RC not applied; B-Type-01: NL software as "goods"
  },
  {
    id:       'client_005',
    name:     'Lisa Braun — Fotografin',
    period:   'Q1 2026',
    query:    'Prüfe meine Buchungen — ich habe eine teure Kamera und Autokosten',
    expected: ['B-EÜR-02', 'B-Kfz-01'], // B-EÜR-02: camera >€800 not capitalised; B-Kfz-01: car repair without asset
  },
  {
    id:       'client_006',
    name:     'Michael Fischer — Software-Entwickler',
    period:   'Q1 2026',
    query:    "Check my Q1 books — I have EU clients and just filed UStVA",
    expected: ['B-ZM-01', 'C-04'], // B-ZM-01: RC invoice without customer VAT ID; C-04: wrong UStVA frequency
  },
  {
    id:       'client_007',
    name:     'Sarah Klein — Online-Yoga-Trainerin',
    period:   'Q1 2026',
    query:    'Überprüfe meine Buchungen auf Fehler — besonders meine Rechnungen und Erstattungen',
    expected: ['A-10', 'C-05'],  // A-10: refund not marked; C-05: VAT status contradiction
  },
];

// Default query used if tc.query is not set
const DEFAULT_QUERY = 'Please analyze all bookings and identify all errors, risks and warnings. Check all available blocks (A, B, C, E) and calculate the tax reserve.';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function allIds(report) {
  if (!report) return [];
  return [
    ...(report.errors   ?? []).map(f => f.id),
    ...(report.warnings ?? []).map(f => f.id),
  ];
}

function pad(str, len) {
  return String(str).padEnd(len);
}

// ---------------------------------------------------------------------------
// Main runner
// ---------------------------------------------------------------------------

async function run() {
  console.log('\n=== AI Tax Advisor — Phase 6 Validation ===\n');

  const results = [];
  let passed = 0;

  for (const tc of CLIENTS) {
    process.stdout.write(`Testing ${tc.id} (${tc.name})… `);

    const start = Date.now();
    let result, error;

    try {
      result = await analyzeClient(tc.id, tc.period, tc.query ?? DEFAULT_QUERY, null);
    } catch (err) {
      error = err.message;
    }

    const elapsed = Math.round((Date.now() - start) / 1000);

    if (error) {
      console.log(`ERROR: ${error}`);
      results.push({ ...tc, status: 'ERROR', error, elapsed, found: [], missing: tc.expected, false_positives: [] });
      continue;
    }

    const foundIds    = allIds(result.report);
    const missing     = tc.expected.filter(id => !foundIds.some(f => f === id || f.startsWith(id)));
    const allExpected = tc.expected.join(', ');
    const status      = missing.length === 0 ? 'PASS' : 'FAIL';

    if (status === 'PASS') passed++;

    const errCount  = result.report?.errors?.length   ?? 0;
    const warnCount = result.report?.warnings?.length ?? 0;
    const okCount   = result.report?.ok_checks?.length ?? 0;

    console.log(`${status} [${elapsed}s] — ${errCount} errors, ${warnCount} warnings, ${okCount} ok${missing.length ? ` | MISSING: ${missing.join(', ')}` : ''}`);

    results.push({
      client_id:   tc.id,
      name:        tc.name,
      period:      tc.period,
      status,
      elapsed_s:   elapsed,
      iterations:  result.iterations,
      expected:    tc.expected,
      found_ids:   foundIds,
      missing,
      errors_n:    errCount,
      warnings_n:  warnCount,
      ok_n:        okCount,
      steuerreserve: result.report?.steuerreserve?.recommended_monthly_saving ?? null,
      raw_text_len: result.raw_text?.length ?? 0,
    });
  }

  // Summary table
  console.log('\n─────────────────────────────────────────────');
  console.log(` RESULT: ${passed}/${CLIENTS.length} clients PASS`);

  const totalErrors   = results.reduce((s, r) => s + (r.errors_n   ?? 0), 0);
  const totalWarnings = results.reduce((s, r) => s + (r.warnings_n ?? 0), 0);
  const avgTime       = Math.round(results.reduce((s, r) => s + (r.elapsed_s ?? 0), 0) / results.length);
  console.log(` Total errors found: ${totalErrors} | warnings: ${totalWarnings}`);
  console.log(` Avg response time:  ${avgTime}s`);
  console.log('─────────────────────────────────────────────\n');

  // Detailed FAIL list
  const failed = results.filter(r => r.status !== 'PASS');
  if (failed.length) {
    console.log('Failed cases:');
    failed.forEach(r => {
      console.log(`  ${r.client_id}: missing [${r.missing?.join(', ')}], found [${r.found_ids?.join(', ')}]`);
    });
    console.log('');
  }

  // Save JSON
  const outPath = path.join(__dirname, 'test_results.json');
  fs.writeFileSync(outPath, JSON.stringify({ run_at: new Date().toISOString(), passed, total: CLIENTS.length, results }, null, 2));
  console.log(`Full results saved to: ${outPath}\n`);
}

run().catch(err => {
  console.error('Runner error:', err);
  process.exit(1);
});
