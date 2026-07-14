const db = require('./db');

// Create the ledger table — matches our Day 4 schema
db.exec(`
  CREATE TABLE IF NOT EXISTS ledger (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    financial_date TEXT,
    transaction_date TEXT,
    reference_no TEXT,
    instrument_no TEXT,
    narration TEXT,
    dr REAL,
    cr REAL,
    avail_bal REAL,
    entry_code TEXT
  )
`);

// Create the bank_statement table — matches our Day 4 schema
db.exec(`
  CREATE TABLE IF NOT EXISTS bank_statement (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT,
    reference TEXT,
    narration TEXT,
    money_in REAL,
    money_out REAL,
    balance REAL
  )
`);

console.log('Tables created successfully: ledger, bank_statement');