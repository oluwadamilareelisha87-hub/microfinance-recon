const stringSimilarity = require('string-similarity');

// --- Constants ---
const DATE_TOLERANCE_DAYS = 1;
const NAME_SIMILARITY_THRESHOLD = 0.8;
const SUGGESTION_MIN_SCORE = 0.5;
const FEE_TOLERANCE = 0.05;

const KNOWN_FEE_PATTERNS = [
  { amount: 10, reason: 'NIP FEE retained (not refunded on reversal)' },
  { amount: 9.25, reason: 'NIP FEE retained, net of its own VAT (₦10 - ₦0.75)' },
  { amount: 0.75, reason: 'VAT FEE retained (not refunded on reversal)' },
  { amount: 0.53, reason: 'VAT FEE retained (lower-tier transaction, not refunded)' }
];

// --- Helper: get the transaction amount from a ledger row ---
function getLedgerAmount(row) {
  return row.dr || row.cr;
}

// --- Helper: get the transaction amount from a statement row ---
function getStatementAmount(row) {
  return row.money_in || row.money_out;
}

// --- Helper: how many days apart are two date strings? ---
function daysApart(date1, date2) {
  const d1 = new Date(date1);
  const d2 = new Date(date2);
  const diffMs = Math.abs(d2 - d1);
  return diffMs / (1000 * 60 * 60 * 24);
}

// --- Helper: extract the name portion from a narration (text after the first "|") ---
function extractName(narration) {
  const parts = narration.split('|');
  return (parts[1] || parts[0]).trim();
}

// --- Classify a statement row as MAIN, VAT_FEE, NIP_FEE, REVERSAL_MAIN, or REVERSAL_FEE ---
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

// --- Extract the "core reference" from a narration by stripping known prefixes ---
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

// --- Calculate the combined match score (amount + name + date, weighted) ---
function calculateMatchScore(ledgerRow, stmtRow) {
  const ledgerAmount = getLedgerAmount(ledgerRow);
  const stmtAmount = getStatementAmount(stmtRow);

  const amountGap = Math.abs(ledgerAmount - stmtAmount);
  const amountScore = amountGap === 0 ? 1.0 : Math.max(0, 1 - (amountGap / ledgerAmount));

  const gap = daysApart(ledgerRow.transaction_date, stmtRow.date);
  const dateScore = Math.max(0, 1 - (gap / 5));

  const ledgerName = extractName(ledgerRow.narration);
  const stmtName = extractName(stmtRow.narration);
  const nameScore = stringSimilarity.compareTwoStrings(ledgerName, stmtName);

  const combined = (amountScore * 0.5) + (nameScore * 0.35) + (dateScore * 0.15);

  return {
    combined: Math.round(combined * 1000) / 1000,
    amountScore: Math.round(amountScore * 1000) / 1000,
    dateScore: Math.round(dateScore * 1000) / 1000,
    nameScore: Math.round(nameScore * 1000) / 1000
  };
}

// --- Check if an amount gap matches a known fee-retention pattern ---
function explainDiscrepancy(expectedAmount, actualAmount) {
  const gap = Math.round((expectedAmount - actualAmount) * 100) / 100;
  const match = KNOWN_FEE_PATTERNS.find(p => Math.abs(p.amount - Math.abs(gap)) <= FEE_TOLERANCE);
  if (match) {
    return { gap, explained: true, reason: match.reason };
  }
  return { gap, explained: false, reason: null };
}

// --- Check amount integrity: EXACT, EXPLAINED_FEE, or UNEXPLAINED_GAP ---
function checkAmountIntegrity(ledgerAmount, stmtAmount) {
  const gap = Math.abs(ledgerAmount - stmtAmount);
  if (gap === 0) return { flag: 'EXACT', gap };

  const feeExplanation = explainDiscrepancy(ledgerAmount, stmtAmount);
  if (feeExplanation.explained) return { flag: 'EXPLAINED_FEE', gap, reason: feeExplanation.reason };

  return { flag: 'UNEXPLAINED_GAP', gap };
}

// --- Final scoring function: combines match score + amount integrity penalty ---
function calculateMatchScoreWithIntegrityV2(ledgerRow, stmtRow) {
  const score = calculateMatchScore(ledgerRow, stmtRow);
  const integrity = checkAmountIntegrity(getLedgerAmount(ledgerRow), getStatementAmount(stmtRow));

  let adjustedCombined = score.combined;
  if (integrity.flag === 'UNEXPLAINED_GAP') {
    adjustedCombined = (score.nameScore * 0.65) + (score.dateScore * 0.35);
    adjustedCombined = Math.min(adjustedCombined, 0.75);
  }

  return { ...score, adjustedCombined: Math.round(adjustedCombined * 1000) / 1000, integrity };
}

module.exports = {
  DATE_TOLERANCE_DAYS,
  NAME_SIMILARITY_THRESHOLD,
  SUGGESTION_MIN_SCORE,
  FEE_TOLERANCE,
  KNOWN_FEE_PATTERNS,
  getLedgerAmount,
  getStatementAmount,
  daysApart,
  extractName,
  classifyStatementRow,
  extractCoreReference,
  calculateMatchScore,
  explainDiscrepancy,
  checkAmountIntegrity,
  calculateMatchScoreWithIntegrityV2
};