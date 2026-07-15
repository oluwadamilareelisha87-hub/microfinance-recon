const db = require('./db');

const ledgerCount = db.prepare('SELECT COUNT(*) AS count FROM ledger').get();
const statementCount = db.prepare('SELECT COUNT(*) AS count FROM bank_statement').get();

console.log('Ledger rows:', ledgerCount.count);
console.log('Bank statement rows:', statementCount.count);

console.log('\nSample ledger row:', db.prepare('SELECT * FROM ledger LIMIT 1').get());
console.log('\nSample statement row:', db.prepare('SELECT * FROM bank_statement LIMIT 1').get());