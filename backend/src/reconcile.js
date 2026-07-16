const db = require('./db');

// Pull all rows from both tables into plain JS arrays
const ledgerRows = db.prepare('SELECT * FROM ledger').all();
const statementRows = db.prepare('SELECT * FROM bank_statement').all();

console.log('Loaded ledger rows:', ledgerRows.length);
console.log('Loaded statement rows:', statementRows.length);

// Quick peek at the shape of one row from each, so we remember the fields
console.log('\nSample ledger row:', ledgerRows[0]);
console.log('\nSample statement row:', statementRows[0]);

// --- Layer 1: Amount + Date matching ---

// Helper: turn a ledger transaction amount into one comparable number
// (ledger uses dr/cr separately, statement uses money_in/money_out separately)
function getLedgerAmount(row) {
  return row.dr || row.cr;
}

function getStatementAmount(row) {
  return row.money_in || row.money_out;
}

// Helper: how many days apart are two date strings?
function daysApart(date1, date2) {
  const d1 = new Date(date1);
  const d2 = new Date(date2);
  const diffMs = Math.abs(d2 - d1);
  return diffMs / (1000 * 60 * 60 * 24);
}

const DATE_TOLERANCE_DAYS = 1;
const results = [];

for (const ledgerRow of ledgerRows) {
  const ledgerAmount = getLedgerAmount(ledgerRow);

  // Find statement rows with the same amount, within date tolerance
  const candidates = statementRows.filter(stmtRow => {
    const stmtAmount = getStatementAmount(stmtRow);
    if (stmtAmount !== ledgerAmount) return false;

    const gap = daysApart(ledgerRow.transaction_date, stmtRow.date);
    return gap <= DATE_TOLERANCE_DAYS;
  });

  results.push({
    ledgerId: ledgerRow.id,
    ledgerNarration: ledgerRow.narration,
    ledgerAmount,
    candidateCount: candidates.length,
    candidates: candidates.map(c => ({ id: c.id, narration: c.narration }))
  });
}

console.log('\n--- Layer 1 Classification ---');

const matched = [];
const unmatched = [];
const duplicateSuspects = [];

// Track which statement IDs get claimed by more than one ledger row
const statementClaimCount = {};
results.forEach(r => {
  r.candidates.forEach(c => {
    statementClaimCount[c.id] = (statementClaimCount[c.id] || 0) + 1;
  });
});

results.forEach(r => {
  if (r.candidateCount === 0) {
    unmatched.push(r);
  } else {
    // Check if any of this ledger row's candidates are claimed by other ledger rows too
    const isDuplicateSuspect = r.candidates.some(c => statementClaimCount[c.id] > 1);
    if (isDuplicateSuspect) {
      duplicateSuspects.push(r);
    } else {
      matched.push(r);
    }
  }
});

console.log(`\nMatched: ${matched.length}`);
matched.forEach(r => console.log(`  ✅ Ledger #${r.ledgerId} — "${r.ledgerNarration}"`));

console.log(`\nUnmatched (needs review): ${unmatched.length}`);
unmatched.forEach(r => console.log(`  ❌ Ledger #${r.ledgerId} — "${r.ledgerNarration}"`));

console.log(`\nDuplicate suspicion (needs review): ${duplicateSuspects.length}`);
duplicateSuspects.forEach(r => console.log(`  ⚠️  Ledger #${r.ledgerId} — "${r.ledgerNarration}" → candidates: ${r.candidates.map(c => c.id).join(', ')}`));

// --- Fee-line and Reversal Detection (Statement side) ---

function classifyStatementRow(row) {
  const narration = row.narration.toUpperCase();
  if (narration.startsWith('REV-VAT FEE') || narration.startsWith('REV-NIP FEE')) {
    return 'REVERSAL_FEE';
  }
  if (narration.startsWith('REV-')) {
    return 'REVERSAL_MAIN';
  }
  if (narration.includes('VAT FEE')) {
    return 'VAT_FEE';
  }
  if (narration.includes('NIP FEE')) {
    return 'NIP_FEE';
  }
  return 'MAIN';
}

const statementClassified = statementRows.map(row => ({
  ...row,
  lineType: classifyStatementRow(row)
}));

console.log('\n--- Statement Line Classification ---');
const lineTypeCounts = {};
statementClassified.forEach(row => {
  lineTypeCounts[row.lineType] = (lineTypeCounts[row.lineType] || 0) + 1;
});
console.log(lineTypeCounts);

// --- Final Exception Report ---

console.log('\n\n========== FINAL RECONCILIATION REPORT ==========');

console.log(`\n✅ MATCHED (${matched.length}) — no action needed`);
matched.forEach(r => console.log(`   Ledger #${r.ledgerId}: ${r.ledgerNarration} (₦${r.ledgerAmount})`));

console.log(`\n❌ UNMATCHED — LEDGER ONLY (${unmatched.length}) — needs review`);
unmatched.forEach(r => console.log(`   Ledger #${r.ledgerId}: ${r.ledgerNarration} (₦${r.ledgerAmount})`));

console.log(`\n⚠️  DUPLICATE SUSPECTS (${duplicateSuspects.length}) — needs review`);
duplicateSuspects.forEach(r => console.log(`   Ledger #${r.ledgerId}: ${r.ledgerNarration} (₦${r.ledgerAmount})`));

// Statement-only unmatched: MAIN lines with no ledger match at all
const matchedStatementIds = new Set();
[...matched, ...duplicateSuspects].forEach(r => {
  r.candidates.forEach(c => matchedStatementIds.add(c.id));
});

const statementOnlyMain = statementClassified.filter(row =>
  row.lineType === 'MAIN' && !matchedStatementIds.has(row.id)
);

console.log(`\n❌ UNMATCHED — BANK ONLY (${statementOnlyMain.length}) — needs review`);
statementOnlyMain.forEach(row => console.log(`   Statement #${row.id}: ${row.narration} (₦${getStatementAmount(row)})`));

const feeCount = statementClassified.filter(r => r.lineType === 'VAT_FEE' || r.lineType === 'NIP_FEE').length;
const reversalCount = statementClassified.filter(r => r.lineType === 'REVERSAL_MAIN' || r.lineType === 'REVERSAL_FEE').length;

console.log(`\nℹ️  Bank charges (expected, no ledger equivalent): ${feeCount}`);
console.log(`ℹ️  Reversals (expected, no ledger equivalent): ${reversalCount}`);

console.log('\n===================================================');

// --- Link Reversals back to their Original Transactions ---

// Extract the "core reference" from a narration by stripping known prefixes
function extractCoreReference(narration) {
  return narration
    .replace(/^REV-VAT FEE - /i, '')
    .replace(/^REV-NIP FEE - /i, '')
    .replace(/^REV-/i, '')
    .replace(/^VAT FEE - /i, '')
    .replace(/^NIP FEE - /i, '')
    .split('|')[0]
    .trim();
}

// Find every core reference that has a REVERSAL_MAIN line — meaning it got reversed
const reversedCoreRefs = new Set(
  statementClassified
    .filter(row => row.lineType === 'REVERSAL_MAIN')
    .map(row => extractCoreReference(row.narration))
);

// Re-check our "Unmatched - Bank Only" list: remove any MAIN line whose core reference was reversed
const reversedOriginals = statementOnlyMain.filter(row =>
  reversedCoreRefs.has(extractCoreReference(row.narration))
);
const trueStatementOnlyMain = statementOnlyMain.filter(row =>
  !reversedCoreRefs.has(extractCoreReference(row.narration))
);

console.log('\n\n========== UPDATED REPORT (Reversals Linked) ==========');

console.log(`\n🔄 REVERSED — NO ACTION NEEDED (${reversedOriginals.length})`);
reversedOriginals.forEach(row => console.log(`   Statement #${row.id}: ${row.narration} (₦${getStatementAmount(row)})`));

console.log(`\n❌ UNMATCHED — BANK ONLY, TRUE EXCEPTIONS (${trueStatementOnlyMain.length})`);
trueStatementOnlyMain.forEach(row => console.log(`   Statement #${row.id}: ${row.narration} (₦${getStatementAmount(row)})`));

console.log('\n=========================================================');