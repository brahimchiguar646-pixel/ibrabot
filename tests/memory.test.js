const assert = require('assert');
const path = require('path');
const fs = require('fs');

process.env.TELEGRAM_TOKEN = 'test';
process.env.OPENROUTER_API_KEY = 'test';

const TEST_DB = path.join(__dirname, '../memory_test.db');
process.env.TEST_DB = TEST_DB;

const sqlite3 = require('sqlite3').verbose();

let db;

function setup() {
  return new Promise((resolve) => {
    db = new sqlite3.Database(TEST_DB, () => {
      db.run(`CREATE TABLE IF NOT EXISTS deep_memory (
        userId TEXT, category TEXT, key TEXT, value TEXT, updatedAt INTEGER
      )`, resolve);
    });
  });
}

function cleanup() {
  return new Promise((resolve) => {
    db.close(() => {
      try { fs.unlinkSync(TEST_DB); } catch {}
      resolve();
    });
  });
}

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) reject(err); else resolve({ lastID: this.lastID });
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => { if (err) reject(err); else resolve(rows); });
  });
}

async function testSaveFact() {
  await run(`INSERT INTO deep_memory (userId, category, key, value, updatedAt) VALUES (?, ?, ?, ?, ?)`,
    ['u1', 'personas', 'nombre', 'Ibrahim', Date.now()]);

  const rows = await all(`SELECT * FROM deep_memory WHERE userId = ? AND category = ?`, ['u1', 'personas']);
  assert.strictEqual(rows.length, 1, 'Should have 1 fact');
  assert.strictEqual(rows[0].value, 'Ibrahim', 'Value should be Ibrahim');
  console.log('  ✅ testSaveFact passed');
}

async function testLoadProfile() {
  await run(`INSERT INTO deep_memory (userId, category, key, value, updatedAt) VALUES (?, ?, ?, ?, ?)`,
    ['u2', 'lugares', 'ciudad', 'Madrid', Date.now()]);
  await run(`INSERT INTO deep_memory (userId, category, key, value, updatedAt) VALUES (?, ?, ?, ?, ?)`,
    ['u2', 'gustos', 'comida_favorita', 'paella', Date.now()]);

  const rows = await all(`SELECT category, key, value FROM deep_memory WHERE userId = ?`, ['u2']);
  const profile = {};
  rows.forEach(r => {
    if (!profile[r.category]) profile[r.category] = {};
    if (!profile[r.category][r.key]) profile[r.category][r.key] = [];
    profile[r.category][r.key].push(r.value);
  });

  assert.strictEqual(profile.lugares.ciudad[0], 'Madrid', 'Ciudad should be Madrid');
  assert.strictEqual(profile.gustos.comida_favorita[0], 'paella', 'Comida should be paella');
  console.log('  ✅ testLoadProfile passed');
}

async function testLoadTasks() {
  const task = { accion: 'Llamar al médico', fecha: '2025-01-10', hora: '10:00', prioridad: 'alta', estado: 'pendiente' };
  await run(`INSERT INTO deep_memory (userId, category, key, value, updatedAt) VALUES (?, 'tareas', 'tarea', ?, ?)`,
    ['u3', JSON.stringify(task), Date.now()]);

  const rows = await all(`SELECT rowid AS id, value FROM deep_memory WHERE userId = ? AND category = 'tareas'`, ['u3']);
  const tasks = rows.map(r => { const o = JSON.parse(r.value); o._id = r.id; return o; });

  assert.strictEqual(tasks.length, 1, 'Should have 1 task');
  assert.strictEqual(tasks[0].accion, 'Llamar al médico', 'Task action should match');
  assert.strictEqual(tasks[0].hora, '10:00', 'Task hour should match');
  console.log('  ✅ testLoadTasks passed');
}

async function testDeleteFact() {
  await run(`INSERT INTO deep_memory (userId, category, key, value, updatedAt) VALUES (?, ?, ?, ?, ?)`,
    ['u4', 'personas', 'nombre', 'Test', Date.now()]);

  await run(`DELETE FROM deep_memory WHERE userId = ? AND category = ? AND key = ?`, ['u4', 'personas', 'nombre']);

  const rows = await all(`SELECT * FROM deep_memory WHERE userId = ?`, ['u4']);
  assert.strictEqual(rows.length, 0, 'Should have 0 facts after delete');
  console.log('  ✅ testDeleteFact passed');
}

async function main() {
  console.log('\n🧪 Running memory tests...\n');
  await setup();

  try {
    await testSaveFact();
    await testLoadProfile();
    await testLoadTasks();
    await testDeleteFact();
    console.log('\n✅ All memory tests passed.\n');
  } catch (err) {
    console.error('\n❌ Test failed:', err.message);
    process.exitCode = 1;
  }

  await cleanup();
}

main();
