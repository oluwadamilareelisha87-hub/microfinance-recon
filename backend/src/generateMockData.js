const db = require('./db');

// --- Helper functions ---

// A small pool of realistic Nigerian names to pick from randomly
const names = [
  'ADEBAYO MUSA', 'CHIOMA OKAFOR', 'EGBAYELO EKUNDAYO ESTHER',
  'IBUKUNOLUWA JOSHUA SUNDAY', 'AIGBEDION ELVIS', 'BAMGBOSE ADEWUNMI GBENGA',
  'ADESOYE OWOLABI', 'OGUNMODEDE SAMUEL TUNDE', 'AMOO GRACE OLUWAFIKUNAYOMI',
  'DAGWAT PETER TONGNAN', 'KATUNG ILIYA MOSES', 'ISAIAH CHRIS'
];

function randomFrom(array) {
  return array[Math.floor(Math.random() * array.length)];
}

function randomAmount(min = 1000, max = 200000) {
  return Math.floor(Math.random() * (max - min) + min);
}

// Formats a JS Date object into 'YYYY-MM-DD' (matches our schema)
function formatDate(date) {
  return date.toISOString().split('T')[0];
}

// Generates a random date in June 2026, optionally shifted by some days
function randomDate(baseDay, shiftDays = 0) {
  const date = new Date(2026, 5, baseDay + shiftDays); // month 5 = June
  return formatDate(date);
}

console.log('Helper functions loaded. Names available:', names.length);
// --- Test Case 1: Clean Matches (with fee-line clutter) ---

const ledgerEntries = [];
const statementEntries = [];

function createCleanMatch(day, refSuffix, name, amount) {
  const ledgerRef = `A26060${refSuffix}`;
  const statementRef = `30391${refSuffix}`;

  // Ledger side: one debit entry
  ledgerEntries.push({
    financial_date: randomDate(day),
    transaction_date: randomDate(day),
    reference_no: ledgerRef,
    instrument_no: String(randomAmount(100000000, 999999999)),
    narration: `Transfer from ${name}|${name}`,
    dr: amount,
    cr: null,
    avail_bal: randomAmount(1000000, 5000000),
    entry_code: 'D265'
  });

  // Statement side: main transaction
  statementEntries.push({
    date: randomDate(day),
    reference: statementRef,
    narration: `000001260601001|${name}`,
    money_in: null,
    money_out: amount,
    balance: randomAmount(1000000, 5000000)
  });

  // Statement side: VAT FEE line
  statementEntries.push({
    date: randomDate(day),
    reference: statementRef,
    narration: `VAT FEE - 000001260601001|${name}`,
    money_in: null,
    money_out: 0.75,
    balance: randomAmount(1000000, 5000000)
  });

  // Statement side: NIP FEE line
  statementEntries.push({
    date: randomDate(day),
    reference: statementRef,
    narration: `NIP FEE - 000001260601001|${name}`,
    money_in: null,
    money_out: 10,
    balance: randomAmount(1000000, 5000000)
  });
}

// Create 5 clean matches using different names/amounts/days
createCleanMatch(1, '010118', 'ADEBAYO MUSA', 18000);
createCleanMatch(2, '010119', 'CHIOMA OKAFOR', 25000);
createCleanMatch(3, '010120', 'EGBAYELO EKUNDAYO ESTHER', 10000);
createCleanMatch(4, '010121', 'AIGBEDION ELVIS', 5200);
createCleanMatch(5, '010122', 'DAGWAT PETER TONGNAN', 170000);

console.log('Clean match entries created. Ledger:', ledgerEntries.length, '| Statement:', statementEntries.length);
// --- Test Case 2: Reversals ---

function createReversal(day, refSuffix, name, amount) {
  const statementRef = `30392${refSuffix}`;

  // Original transaction (main + fees) — same pattern as a clean match
  statementEntries.push({
    date: randomDate(day),
    reference: statementRef,
    narration: `000001260601002|${name}`,
    money_in: null,
    money_out: amount,
    balance: randomAmount(1000000, 5000000)
  });
  statementEntries.push({
    date: randomDate(day),
    reference: statementRef,
    narration: `VAT FEE - 000001260601002|${name}`,
    money_in: null,
    money_out: 0.75,
    balance: randomAmount(1000000, 5000000)
  });
  statementEntries.push({
    date: randomDate(day),
    reference: statementRef,
    narration: `NIP FEE - 000001260601002|${name}`,
    money_in: null,
    money_out: 10,
    balance: randomAmount(1000000, 5000000)
  });

  // Reversal — same amounts, but coming back IN, with REV- prefix
  statementEntries.push({
    date: randomDate(day, 1), // reversal happens 1 day later
    reference: statementRef,
    narration: `REV-000001260601002|${name}`,
    money_in: amount,
    money_out: null,
    balance: randomAmount(1000000, 5000000)
  });
  statementEntries.push({
    date: randomDate(day, 1),
    reference: statementRef,
    narration: `REV-VAT FEE - 000001260601002|${name}`,
    money_in: 0.75,
    money_out: null,
    balance: randomAmount(1000000, 5000000)
  });
  statementEntries.push({
    date: randomDate(day, 1),
    reference: statementRef,
    narration: `REV-NIP FEE - 000001260601002|${name}`,
    money_in: 10,
    money_out: null,
    balance: randomAmount(1000000, 5000000)
  });

  // Note: no ledger entry created here on purpose — this transaction
  // never appears on the ledger side at all, similar to how the fee-only
  // reversal pattern showed up in your real document.
}

createReversal(10, '084841', 'AJIBOYE AKINOLA OLAYEMI', 90000);

console.log('Reversal entries created. Statement total now:', statementEntries.length);

// --- Test Case 3: Date mismatch within tolerance (should still match) ---
ledgerEntries.push({
  financial_date: randomDate(12), transaction_date: randomDate(12),
  reference_no: 'A2606010200', instrument_no: '111222333',
  narration: 'Transfer from ISAIAH CHRIS|ISAIAH CHRIS',
  dr: 15000, cr: null, avail_bal: randomAmount(1000000, 5000000), entry_code: 'D265'
});
statementEntries.push({
  date: randomDate(12, 1), // 1 day later on the bank side
  reference: '3039300100', narration: '000001260601003|ISAIAH CHRIS',
  money_in: null, money_out: 15000, balance: randomAmount(1000000, 5000000)
});

// --- Test Case 4: Amount mismatch beyond tolerance (should NOT match) ---
ledgerEntries.push({
  financial_date: randomDate(13), transaction_date: randomDate(13),
  reference_no: 'A2606010201', instrument_no: '222333444',
  narration: 'Transfer from ADESOYE OWOLABI|ADESOYE OWOLABI',
  dr: 5200, cr: null, avail_bal: randomAmount(1000000, 5000000), entry_code: 'D265'
});
statementEntries.push({
  date: randomDate(13), reference: '3039300101', narration: '000001260601004|ADESOYE OWOLABI',
  money_in: null, money_out: 6000, // different amount on purpose
  balance: randomAmount(1000000, 5000000)
});

// --- Test Case 5: Missing on bank side (ledger-only, e.g. pending) ---
ledgerEntries.push({
  financial_date: randomDate(14), transaction_date: randomDate(14),
  reference_no: 'A2606010202', instrument_no: '333444555',
  narration: 'Transfer from KATUNG ILIYA MOSES|KATUNG ILIYA MOSES',
  dr: 16000, cr: null, avail_bal: randomAmount(1000000, 5000000), entry_code: 'D265'
});
// (intentionally no statement entry created)

// --- Test Case 6: Missing on ledger side (bank-only, unexplained) ---
statementEntries.push({
  date: randomDate(15), reference: '3039300102', narration: '000001260601005|OGUNMODEDE SAMUEL TUNDE',
  money_in: null, money_out: 25000, balance: randomAmount(1000000, 5000000)
});
// (intentionally no ledger entry created)

// --- Test Case 7: Fuzzy name mismatch (typo, should still fuzzy-match) ---
ledgerEntries.push({
  financial_date: randomDate(16), transaction_date: randomDate(16),
  reference_no: 'A2606010203', instrument_no: '444555666',
  narration: 'Transfer from AMOO GRACE OLUWAFIKUNAYOMI|AMOO GRACE OLUWAFIKUNAYOMI',
  dr: 29500, cr: null, avail_bal: randomAmount(1000000, 5000000), entry_code: 'D265'
});
statementEntries.push({
  date: randomDate(16), reference: '3039300103', narration: '000001260601006|AMOO GRACE OLUWAFIKUNAYONI', // typo: N instead of M
  money_in: null, money_out: 29500, balance: randomAmount(1000000, 5000000)
});

// --- Test Case 8: Duplicate suspicion (two ledger entries, one statement line) ---
ledgerEntries.push({
  financial_date: randomDate(17), transaction_date: randomDate(17),
  reference_no: 'A2606010204', instrument_no: '555666777',
  narration: 'Transfer from AIGBEDION ELVIS|AIGBEDION ELVIS',
  dr: 5200, cr: null, avail_bal: randomAmount(1000000, 5000000), entry_code: 'D265'
});
ledgerEntries.push({
  financial_date: randomDate(17), transaction_date: randomDate(17),
  reference_no: 'A2606010205', instrument_no: '666777888',
  narration: 'Transfer from AIGBEDION ELVIS|AIGBEDION ELVIS',
  dr: 5200, cr: null, avail_bal: randomAmount(1000000, 5000000), entry_code: 'D265'
});
statementEntries.push({
  date: randomDate(17), reference: '3039300104', narration: '000001260601007|AIGBEDION ELVIS',
  money_in: null, money_out: 5200, balance: randomAmount(1000000, 5000000)
});

console.log('All test cases created. Final totals — Ledger:', ledgerEntries.length, '| Statement:', statementEntries.length);

// --- Insert everything into the database ---

const insertLedger = db.prepare(`
  INSERT INTO ledger (financial_date, transaction_date, reference_no, instrument_no, narration, dr, cr, avail_bal, entry_code)
  VALUES (@financial_date, @transaction_date, @reference_no, @instrument_no, @narration, @dr, @cr, @avail_bal, @entry_code)
`);

const insertStatement = db.prepare(`
  INSERT INTO bank_statement (date, reference, narration, money_in, money_out, balance)
  VALUES (@date, @reference, @narration, @money_in, @money_out, @balance)
`);
db.exec('DELETE FROM ledger; DELETE FROM bank_statement;');
const insertAll = db.transaction(() => {
  for (const entry of ledgerEntries) insertLedger.run(entry);
  for (const entry of statementEntries) insertStatement.run(entry);
});

insertAll();

console.log('Data inserted into database successfully!');