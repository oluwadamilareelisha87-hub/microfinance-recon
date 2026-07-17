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

// --- Layer 2: Fuzzy Name Matching (confidence scoring) ---

const stringSimilarity = require('string-similarity');

// Extract the name portion from a narration (text after the first "|")
function extractName(narration) {
  const parts = narration.split('|');
  return (parts[1] || parts[0]).trim();
}

const NAME_SIMILARITY_THRESHOLD = 0.8;

console.log('\n\n========== LAYER 2: NAME CONFIDENCE CHECK ==========');

matched.forEach(r => {
  const ledgerName = extractName(r.ledgerNarration);
  // Use the first candidate's narration (matched entries only have 1 non-conflicting candidate)
  const stmtNarration = r.candidates[0].narration;
  const stmtName = extractName(stmtNarration);

  const score = stringSimilarity.compareTwoStrings(ledgerName, stmtName);
  const confidence = score >= NAME_SIMILARITY_THRESHOLD ? 'HIGH' : 'LOW';

  console.log(`Ledger #${r.ledgerId}: "${ledgerName}" vs "${stmtName}" → ${(score * 100).toFixed(1)}% (${confidence} confidence)`);
});

console.log('\n=====================================================');

// --- Fee-Retention Pattern Detection (handles cases like the ₦9.25 discrepancy) ---

// Known fee amounts we've observed in real bank data (Day 3 documents)
const KNOWN_FEE_PATTERNS = [
  { amount: 10, reason: 'NIP FEE retained (not refunded on reversal)' },
  { amount: 9.25, reason: 'NIP FEE retained, net of its own VAT (₦10 - ₦0.75)' },
  { amount: 0.75, reason: 'VAT FEE retained (not refunded on reversal)' },
  { amount: 0.53, reason: 'VAT FEE retained (lower-tier transaction, not refunded)' }
];

const FEE_TOLERANCE = 0.05; // allow tiny rounding differences

function explainDiscrepancy(expectedAmount, actualAmount) {
  const gap = Math.round((expectedAmount - actualAmount) * 100) / 100;
  const match = KNOWN_FEE_PATTERNS.find(p => Math.abs(p.amount - Math.abs(gap)) <= FEE_TOLERANCE);
  if (match) {
    return { gap, explained: true, reason: match.reason };
  }
  return { gap, explained: false, reason: null };
}

console.log('\n\n========== FEE-RETENTION PATTERN CHECK ==========');
console.log('Example using the real ₦9.25 case (₦47,510 expected vs ₦47,500.75 refunded):');

const example = explainDiscrepancy(47510, 47500.75);
console.log(`Gap: ₦${example.gap} → ${example.explained ? '✅ Explained: ' + example.reason : '❌ Unexplained — needs review'}`);

console.log('\n===================================================');

// --- Apply Fee-Retention Explanation to Real Unmatched Entries ---

console.log('\n\n========== APPLYING PATTERN CHECK TO UNMATCHED ENTRIES ==========');

// For each ledger-only unmatched entry, check if there's a statement row with a CLOSE (not exact) amount
unmatched.forEach(r => {
  const closeMatches = statementRows.filter(stmtRow => {
    const stmtAmount = getStatementAmount(stmtRow);
    const gap = Math.abs(r.ledgerAmount - stmtAmount);
    return gap > 0 && gap <= 15; // within a plausible fee-sized gap, but not an exact match
  });

  if (closeMatches.length > 0) {
    closeMatches.forEach(stmtRow => {
      const stmtAmount = getStatementAmount(stmtRow);
      const result = explainDiscrepancy(r.ledgerAmount, stmtAmount);
      console.log(`Ledger #${r.ledgerId} (₦${r.ledgerAmount}) vs Statement #${stmtRow.id} (₦${stmtAmount})`);
      console.log(`  Gap: ₦${result.gap} → ${result.explained ? '✅ ' + result.reason : '❌ Unexplained — needs review'}`);
    });
  }
});

console.log('\n===================================================');

// --- Combined Confidence Scoring for Match Suggestions ---

function calculateMatchScore(ledgerRow, stmtRow) {
  const ledgerAmount = getLedgerAmount(ledgerRow);
  const stmtAmount = getStatementAmount(stmtRow);

  // Amount score: 1.0 if exact, decreasing as gap grows (capped at 0)
  const amountGap = Math.abs(ledgerAmount - stmtAmount);
  const amountScore = amountGap === 0 ? 1.0 : Math.max(0, 1 - (amountGap / ledgerAmount));

  // Date score: 1.0 if same day, decreasing with days apart
  const gap = daysApart(ledgerRow.transaction_date, stmtRow.date);
  const dateScore = Math.max(0, 1 - (gap / 5)); // 5+ days apart = 0 score

  // Name score: fuzzy similarity between extracted names
  const ledgerName = extractName(ledgerRow.narration);
  const stmtName = extractName(stmtRow.narration);
  const nameScore = stringSimilarity.compareTwoStrings(ledgerName, stmtName);

  // Weighted combined score — amount matters most, then name, then date
  const combined = (amountScore * 0.5) + (nameScore * 0.35) + (dateScore * 0.15);

  return {
    combined: Math.round(combined * 1000) / 1000,
    amountScore: Math.round(amountScore * 1000) / 1000,
    dateScore: Math.round(dateScore * 1000) / 1000,
    nameScore: Math.round(nameScore * 1000) / 1000
  };
}

console.log('\n\n========== TESTING COMBINED SCORE ==========');
const testScore = calculateMatchScore(ledgerRows[0], statementRows[0]);
console.log('Ledger #1 vs Statement #1:', testScore);
console.log('\n=============================================');

// --- Ranked Match Suggestions ---

console.log('\n\n========== RANKED MATCH SUGGESTIONS ==========');

const SUGGESTION_MIN_SCORE = 0.5; // ignore wildly unrelated candidates

ledgerRows.forEach(ledgerRow => {
  // Only compare against MAIN statement lines (not fee/reversal lines)
  const mainStatementRows = statementClassified.filter(row => row.lineType === 'MAIN');

  const scored = mainStatementRows
    .map(stmtRow => ({
      stmtRow,
      score: calculateMatchScore(ledgerRow, stmtRow)
    }))
    .filter(s => s.score.combined >= SUGGESTION_MIN_SCORE)
    .sort((a, b) => b.score.combined - a.score.combined)
    .slice(0, 3); // top 3 only

  if (scored.length > 0) {
    console.log(`\nLedger #${ledgerRow.id}: "${extractName(ledgerRow.narration)}" (₦${getLedgerAmount(ledgerRow)})`);
    scored.forEach((s, i) => {
      console.log(`  ${i + 1}. Statement #${s.stmtRow.id}: "${extractName(s.stmtRow.narration)}" (₦${getStatementAmount(s.stmtRow)}) → ${(s.score.combined * 100).toFixed(1)}% confidence`);
    });
  }
});

console.log('\n=================================================');

// --- Amount Integrity Check (prevents high confidence from masking real mismatches) ---

function checkAmountIntegrity(ledgerAmount, stmtAmount) {
  const gap = Math.abs(ledgerAmount - stmtAmount);
  if (gap === 0) return { flag: 'EXACT', gap };

  const feeExplanation = explainDiscrepancy(ledgerAmount, stmtAmount);
  if (feeExplanation.explained) return { flag: 'EXPLAINED_FEE', gap, reason: feeExplanation.reason };

  return { flag: 'UNEXPLAINED_GAP', gap };
}

console.log('\n\n========== RANKED SUGGESTIONS WITH AMOUNT INTEGRITY ==========');

ledgerRows.forEach(ledgerRow => {
  const mainStatementRows = statementClassified.filter(row => row.lineType === 'MAIN');
  const ledgerAmount = getLedgerAmount(ledgerRow);

  const scored = mainStatementRows
    .map(stmtRow => ({
      stmtRow,
      score: calculateMatchScore(ledgerRow, stmtRow),
      integrity: checkAmountIntegrity(ledgerAmount, getStatementAmount(stmtRow))
    }))
    .filter(s => s.score.combined >= SUGGESTION_MIN_SCORE)
    .sort((a, b) => b.score.combined - a.score.combined)
    .slice(0, 3);

  if (scored.length > 0) {
    console.log(`\nLedger #${ledgerRow.id}: "${extractName(ledgerRow.narration)}" (₦${ledgerAmount})`);
    scored.forEach((s, i) => {
      let warning = '';
      if (s.integrity.flag === 'UNEXPLAINED_GAP') {
        warning = `  ⚠️  AMOUNT MISMATCH: ₦${s.integrity.gap} unexplained gap — DO NOT auto-confirm`;
      } else if (s.integrity.flag === 'EXPLAINED_FEE') {
        warning = `  ℹ️  Gap explained: ${s.integrity.reason}`;
      }
      console.log(`  ${i + 1}. Statement #${s.stmtRow.id}: "${extractName(s.stmtRow.narration)}" (₦${getStatementAmount(s.stmtRow)}) → ${(s.score.combined * 100).toFixed(1)}% confidence`);
      if (warning) console.log(warning);
    });
  }
});

console.log('\n=================================================================');


// --- Penalize Combined Score for Unexplained Amount Gaps ---

function calculateMatchScoreWithIntegrity(ledgerRow, stmtRow) {
  const score = calculateMatchScore(ledgerRow, stmtRow);
  const integrity = checkAmountIntegrity(getLedgerAmount(ledgerRow), getStatementAmount(stmtRow));

  let adjustedCombined = score.combined;
  if (integrity.flag === 'UNEXPLAINED_GAP') {
    adjustedCombined = adjustedCombined * 0.4; // heavy penalty — pushes it visibly lower
  }

  return { ...score, adjustedCombined: Math.round(adjustedCombined * 1000) / 1000, integrity };
}

console.log('\n\n========== FINAL RANKED SUGGESTIONS (CORRECTED) ==========');

ledgerRows.forEach(ledgerRow => {
  const mainStatementRows = statementClassified.filter(row => row.lineType === 'MAIN');
  const ledgerAmount = getLedgerAmount(ledgerRow);

  const scored = mainStatementRows
    .map(stmtRow => ({ stmtRow, s: calculateMatchScoreWithIntegrityV2(ledgerRow, stmtRow) }))
    .filter(x => x.s.adjustedCombined >= SUGGESTION_MIN_SCORE || (x.s.integrity.flag === 'UNEXPLAINED_GAP' && x.s.nameScore >= 0.75))
    .sort((a, b) => b.s.adjustedCombined - a.s.adjustedCombined)
    .slice(0, 3);

  if (scored.length > 0) {
    console.log(`\nLedger #${ledgerRow.id}: "${extractName(ledgerRow.narration)}" (₦${ledgerAmount})`);
    scored.forEach((x, i) => {
      const warn = x.s.integrity.flag === 'UNEXPLAINED_GAP' ? `  ⚠️  Amount mismatch (₦${x.s.integrity.gap} gap) — not auto-confirmable` : '';
      console.log(`  ${i + 1}. Statement #${x.stmtRow.id}: "${extractName(x.stmtRow.narration)}" → ${(x.s.adjustedCombined * 100).toFixed(1)}% confidence`);
      if (warn) console.log(warn);
    });
  }
});

console.log('\n=================================================================');

// --- Better Penalty: only crush the AMOUNT component, keep name+date credit ---

function calculateMatchScoreWithIntegrityV2(ledgerRow, stmtRow) {
  const score = calculateMatchScore(ledgerRow, stmtRow);
  const integrity = checkAmountIntegrity(getLedgerAmount(ledgerRow), getStatementAmount(stmtRow));

  let adjustedCombined = score.combined;
  if (integrity.flag === 'UNEXPLAINED_GAP') {
    // Recompute using name + date only (amount treated as untrusted, not "wrong")
    adjustedCombined = (score.nameScore * 0.65) + (score.dateScore * 0.35);
    adjustedCombined = Math.min(adjustedCombined, 0.75); // hard cap: never beats a real exact match
  }

  return { ...score, adjustedCombined: Math.round(adjustedCombined * 1000) / 1000, integrity };
}


// --- Duplicate Suspect Tie-Breaking ---

console.log('\n\n========== DUPLICATE SUSPECT ANALYSIS ==========');

duplicateSuspects.forEach(r => {
  const ledgerRow = ledgerRows.find(l => l.id === r.ledgerId);
  console.log(`\nLedger #${r.ledgerId}: "${r.ledgerNarration}" (${ledgerRow.transaction_date})`);

  r.candidates.forEach(c => {
    const stmtRow = statementRows.find(s => s.id === c.id);
    const score = calculateMatchScore(ledgerRow, stmtRow);
    console.log(`  → Statement #${c.id} (${stmtRow.date}): date diff = ${daysApart(ledgerRow.transaction_date, stmtRow.date)} day(s), combined score = ${(score.combined * 100).toFixed(1)}%`);
  });
});

console.log('\nRecommendation: When scores are truly tied, flag BOTH for manual review —');
console.log('do not auto-pick one, since picking wrong misallocates a real transaction.');

console.log('\n=================================================');

// --- Ranked Suggestions for Bank-Only (Statement) Exceptions ---

console.log('\n\n========== BANK-ONLY EXCEPTIONS: RANKED SUGGESTIONS ==========');

trueStatementOnlyMain.forEach(stmtRow => {
  const stmtAmount = getStatementAmount(stmtRow);

  const scored = ledgerRows
    .map(ledgerRow => ({
      ledgerRow,
      s: calculateMatchScoreWithIntegrityV2(ledgerRow, stmtRow)
    }))
    .filter(x => x.s.nameScore >= 0.5 && (x.s.adjustedCombined >= SUGGESTION_MIN_SCORE || x.s.integrity.flag === 'UNEXPLAINED_GAP'))
    .sort((a, b) => b.s.adjustedCombined - a.s.adjustedCombined)
    .slice(0, 3);

  console.log(`\nStatement #${stmtRow.id}: "${extractName(stmtRow.narration)}" (₦${stmtAmount})`);
  if (scored.length === 0) {
    console.log('  No plausible ledger candidates found — likely a genuine unrecorded bank-side transaction.');
  } else {
    scored.forEach((x, i) => {
      const warn = x.s.integrity.flag === 'UNEXPLAINED_GAP' ? `  ⚠️  Amount mismatch (₦${x.s.integrity.gap} gap) — not auto-confirmable` : '';
      console.log(`  ${i + 1}. Ledger #${x.ledgerRow.id}: "${extractName(x.ledgerRow.narration)}" → ${(x.s.adjustedCombined * 100).toFixed(1)}% confidence`);
      if (warn) console.log(warn);
    });
  }
});

console.log('\n=================================================================');