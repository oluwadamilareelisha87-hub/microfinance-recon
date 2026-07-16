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