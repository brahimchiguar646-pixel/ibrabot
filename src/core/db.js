const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const logger = require('../utils/logger');

const DB_PATH = path.join(__dirname, '../../memory.db');

let db;

function getDb() {
  if (db) return db;

  db = new sqlite3.Database(DB_PATH, (err) => {
    if (err) logger.error('Error abriendo SQLite: ' + err.message);
    else logger.success('SQLite cargado correctamente.');
  });

  db.run(`
    CREATE TABLE IF NOT EXISTS deep_memory (
      userId TEXT,
      category TEXT,
      key TEXT,
      value TEXT,
      updatedAt INTEGER
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS pending_actions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      userId TEXT,
      action TEXT,
      payload TEXT,
      status TEXT DEFAULT 'pending',
      createdAt INTEGER,
      resolvedAt INTEGER
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS agent_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      userId TEXT,
      event TEXT,
      detail TEXT,
      ts INTEGER
    )
  `);

  return db;
}

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    getDb().run(sql, params, function (err) {
      if (err) reject(err);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    getDb().all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    getDb().get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

module.exports = { getDb, run, all, get };
