'use strict';

/**
 * Deterministic orchestrator test — NO Anthropic API calls.
 * Verifies that the code-based checks fire in the main analyze path.
 *
 * Usage: node backend/test_orchestrator.js
 */

const { loadClientData, runAllChecks } = require('./orchestrator');

// Phase-4 expectations (full check set: Block A + B + C + E).
const CASES = [
  { id: 'client_001', period: 'Full Year 2026', expect: ['A-12'] },
  { id: 'client_002', period: 'Full Year 2025', expect: ['B-04'] },
  { id: 'client_003', period: 'Q1 2026',        expect: ['A-11', 'A-10', 'E-09'] },
  { id: 'client_004', period: 'Q1 2026',        expect: ['A-12', 'B-Type-01', 'B-Kfz-01'] },
  { id: 'client_005', period: 'Q1 2026',        expect: ['B-Kfz-01', 'B-EÜR-02', 'E-02'] },
  { id: 'client_006', period: 'Q1 2026',        expect: ['B-ZM-01', 'C-04'] },
  { id: 'client_007', period: 'Q1 2026',        expect: ['A-10', 'C-09', 'E-02'] },
];

(async () => {
  let allOk = true;
  for (const tc of CASES) {
    const data = await loadClientData(tc.id, tc.period);
    const { findings, okCheckIds } = runAllChecks(data);
    const ids = findings.map(f => `${f.check_id}[${(f.affected || []).join(',')}]`);
    const foundCheckIds = new Set(findings.map(f => f.check_id));
    const missing = tc.expect.filter(id => !foundCheckIds.has(id));
    const status = missing.length === 0 ? 'PASS' : 'FAIL';
    if (status !== 'PASS') allOk = false;
    console.log(`\n${status} ${tc.id} (${tc.period})`);
    console.log(`  findings: ${ids.length ? ids.join('  ') : '(none)'}`);
    console.log(`  ok_checks: ${okCheckIds.join(', ')}`);
    if (missing.length) console.log(`  MISSING expected: ${missing.join(', ')}`);
  }
  console.log(`\n=== ${allOk ? 'ALL EXPECTED CHECKS FIRED' : 'SOME EXPECTED CHECKS MISSING'} ===\n`);
  process.exit(allOk ? 0 : 1);
})();
