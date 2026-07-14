const Database = require('better-sqlite3');
const path = require('path');

// This creates (or opens, if it already exists) a file called recon.db
// inside the backend folder — this file IS our entire database.
const dbPath = path.join(__dirname, '..', 'recon.db');
const db = new Database(dbPath);

// This just confirms the connection worked when we run this file directly.
console.log('Connected to SQLite database at:', dbPath);

module.exports = db;