'use strict';

/**
 * Phase 2 test script — verifies the agent connects to Claude API,
 * runs the tool_use loop, and finds the known test-case errors.
 *
 * Run: node backend/test_agent.js
 * Requires: ANTHROPIC_API_KEY in backend/.env or root .env
 *
 * Expected: agent finds both pre-planted errors:
 *   - Test Case #1: Reverse Charge error in client_001
 *   - Test Case #2: Home Office contradiction in client_002
 */

const { analyzeClient } = require('./agent');

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (!condition) throw new Error(message ?? 'Assertion failed');
}

async function test(label, fn) {
  try {
    await fn();
    console.log(`[PASS] ${label}`);
    passed++;
  } catch (err) {
    console.error(`[FAIL] ${label}`);
    console.error(`       ${err.message}`);
    failed++;
  }
}

// ---------------------------------------------------------------------------
// Test Case #1 — client_001: Reverse Charge error
// entry_001_009 has tax_residency=domestic + vat_rate=0.19
// but inv_001_006 shows supplier_country=IE + vat_rate=0.00
// Expected: agent flags this as ERROR
// ---------------------------------------------------------------------------

async function testClient001() {
  console.log('\n--- Test Case #1: client_001 (Reverse Charge) ---');
  console.log('Calling agent... (this takes ~20–40 seconds)');

  let result;
  await test('client_001: agent completes without error', async () => {
    result = await analyzeClient(
      'client_001',
      'Q1 2026',
      'Check my Q1 2026 books for errors. Pay special attention to VAT and bookkeeping entries.'
    );
    assert(result.threadId, 'No threadId returned');
    assert(result.report !== null, 'No JSON report found in response. Raw text:\n' + result.raw_text?.slice(0, 500));
  });

  if (!result?.report) return;

  await test('client_001: report has required structure', async () => {
    const r = result.report;
    assert(Array.isArray(r.errors),    'report.errors is not an array');
    assert(Array.isArray(r.warnings),  'report.warnings is not an array');
    assert(Array.isArray(r.ok_checks), 'report.ok_checks is not an array');
    assert(r.steuerreserve !== undefined, 'report.steuerreserve missing');
  });

  await test('client_001: Reverse Charge error detected (entry_001_009 vs inv_001_006)', async () => {
    const r = result.report;
    const allFindings = [...r.errors, ...r.warnings];

    // Check if any finding references the RC issue
    const rcFinding = allFindings.find(f => {
      const text = JSON.stringify(f).toLowerCase();
      return (
        text.includes('reverse charge') ||
        text.includes('entry_001_009') ||
        text.includes('inv_001_006') ||
        (text.includes('ie') && text.includes('vat')) ||
        text.includes('§13b')
      );
    });

    assert(rcFinding,
      `Reverse Charge error not found in findings.\n` +
      `Errors found: ${r.errors.map(e => e.title).join(', ') || 'none'}\n` +
      `Warnings found: ${r.warnings.map(w => w.title).join(', ') || 'none'}`
    );

    console.log(`       ✓ Found: [${rcFinding.id ?? '?'}] ${rcFinding.title}`);
  });

  await test('client_001: steuerreserve has numeric values', async () => {
    const s = result.report.steuerreserve;
    assert(typeof s.recommended_monthly_saving === 'number',
      'recommended_monthly_saving is not a number');
  });

  console.log(`  Agent used ${result.iterations} iteration(s)`);
}

// ---------------------------------------------------------------------------
// Test Case #2 — client_002: Home Office contradiction
// reports_eur shows method=tagespauschale
// but bookkeeping_entries have account_code=6330 (Büroreinigung) in 2025
// Expected: agent flags this as WARNING or ERROR
// ---------------------------------------------------------------------------

async function testClient002() {
  console.log('\n--- Test Case #2: client_002 (Home Office) ---');
  console.log('Calling agent... (this takes ~20–40 seconds)');

  let result;
  await test('client_002: agent completes without error', async () => {
    result = await analyzeClient(
      'client_002',
      'Full Year 2025',
      'Check my 2025 books. I use home office — please verify my home office deductions are correct.'
    );
    assert(result.threadId, 'No threadId returned');
    assert(result.report !== null, 'No JSON report found in response. Raw text:\n' + result.raw_text?.slice(0, 500));
  });

  if (!result?.report) return;

  await test('client_002: Home Office contradiction detected', async () => {
    const r = result.report;
    const allFindings = [...r.errors, ...r.warnings];

    const hoFinding = allFindings.find(f => {
      const text = JSON.stringify(f).toLowerCase();
      return (
        text.includes('tagespauschale') ||
        text.includes('home office') ||
        text.includes('homeoffice') ||
        text.includes('6330') ||
        text.includes('reinigung') ||
        text.includes('cleaning')
      );
    });

    assert(hoFinding,
      `Home Office contradiction not found in findings.\n` +
      `Errors: ${r.errors.map(e => e.title).join(', ') || 'none'}\n` +
      `Warnings: ${r.warnings.map(w => w.title).join(', ') || 'none'}`
    );

    console.log(`       ✓ Found: [${hoFinding.id ?? '?'}] ${hoFinding.title}`);
  });

  console.log(`  Agent used ${result.iterations} iteration(s)`);
}

// ---------------------------------------------------------------------------
// Multi-turn conversation test — same threadId, follow-up question
// ---------------------------------------------------------------------------

async function testMultiTurn() {
  console.log('\n--- Multi-turn: follow-up question ---');

  let threadId;
  await test('multi-turn: first turn completes', async () => {
    const r1 = await analyzeClient(
      'client_001',
      'Q1 2026',
      'Give me a quick summary of any issues.'
    );
    assert(r1.threadId, 'No threadId');
    threadId = r1.threadId;
  });

  await test('multi-turn: second turn uses same threadId', async () => {
    const r2 = await analyzeClient(
      'client_001',
      'Q1 2026',
      'What should I do about the most critical error you found?',
      threadId
    );
    assert(r2.threadId === threadId, 'threadId changed between turns');
    assert(r2.raw_text?.length > 50, 'Empty response on second turn');
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

(async () => {
  console.log('=== Phase 2: agent.js verification ===');
  console.log('Note: Each test makes real API calls — expect ~1–2 minutes total.\n');

  await testClient001();
  await testClient002();
  await testMultiTurn();

  console.log(`\n${'='.repeat(42)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);

  if (failed > 0) {
    console.error('\nPhase 2 FAILED — fix issues before proceeding to Phase 3.');
    process.exit(1);
  } else {
    console.log('\nPhase 2 PASSED — ready for Phase 3 (server.js).');
  }
})();
