const { run, all, get } = require('../core/db');
const logger = require('../utils/logger');
const fs = require('fs');
const path = require('path');

const BACKUP_DIR = path.join(__dirname, '../../logs/backups');

async function saveFact(userId, category, key, value) {
  try {
    const now = Date.now();
    await run(
      `INSERT INTO deep_memory (userId, category, key, value, updatedAt) VALUES (?, ?, ?, ?, ?)`,
      [userId, category, key, value, now]
    );
  } catch (err) {
    logger.error('saveFact error: ' + err.message);
  }
}

async function updateFact(userId, category, key, value) {
  try {
    const now = Date.now();
    const existing = await get(
      `SELECT rowid FROM deep_memory WHERE userId = ? AND category = ? AND key = ? ORDER BY updatedAt DESC LIMIT 1`,
      [userId, category, key]
    );
    if (existing) {
      await run(
        `UPDATE deep_memory SET value = ?, updatedAt = ? WHERE rowid = ?`,
        [value, now, existing.rowid]
      );
    } else {
      await saveFact(userId, category, key, value);
    }
  } catch (err) {
    logger.error('updateFact error: ' + err.message);
  }
}

async function deleteFact(userId, category, key) {
  try {
    await run(
      `DELETE FROM deep_memory WHERE userId = ? AND category = ? AND key = ?`,
      [userId, category, key]
    );
  } catch (err) {
    logger.error('deleteFact error: ' + err.message);
  }
}

async function loadProfile(userId) {
  try {
    const rows = await all(
      `SELECT category, key, value FROM deep_memory WHERE userId = ?`,
      [userId]
    );
    const profile = {};
    rows.forEach(r => {
      if (!profile[r.category]) profile[r.category] = {};
      if (!profile[r.category][r.key]) profile[r.category][r.key] = [];
      profile[r.category][r.key].push(r.value);
    });
    return profile;
  } catch (err) {
    logger.error('loadProfile error: ' + err.message);
    return {};
  }
}

async function loadTasks(userId) {
  try {
    const rows = await all(
      `SELECT rowid AS id, value FROM deep_memory WHERE userId = ? AND category = 'tareas'`,
      [userId]
    );
    return rows
      .map(r => {
        try {
          const obj = JSON.parse(r.value);
          obj._id = r.id;
          return obj;
        } catch { return null; }
      })
      .filter(Boolean);
  } catch (err) {
    logger.error('loadTasks error: ' + err.message);
    return [];
  }
}

async function updateTask(id, taskObj) {
  try {
    const now = Date.now();
    await run(
      `UPDATE deep_memory SET value = ?, updatedAt = ? WHERE rowid = ?`,
      [JSON.stringify(taskObj), now, id]
    );
  } catch (err) {
    logger.error('updateTask error: ' + err.message);
  }
}

async function deleteTask(id) {
  try {
    await run(`DELETE FROM deep_memory WHERE rowid = ?`, [id]);
  } catch (err) {
    logger.error('deleteTask error: ' + err.message);
  }
}

async function purgeExpiredFacts(olderThanMs = 90 * 24 * 60 * 60 * 1000) {
  try {
    const cutoff = Date.now() - olderThanMs;
    const result = await run(
      `DELETE FROM deep_memory WHERE category != 'tareas' AND updatedAt < ?`,
      [cutoff]
    );
    logger.info(`Purged ${result.changes} expired facts.`);
    return result.changes;
  } catch (err) {
    logger.error('purgeExpiredFacts error: ' + err.message);
    return 0;
  }
}

async function backupMemory() {
  try {
    if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

    const rows = await all(`SELECT * FROM deep_memory`);
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const file = path.join(BACKUP_DIR, `memory_backup_${ts}.json`);
    fs.writeFileSync(file, JSON.stringify(rows, null, 2));
    logger.success('Memory backup saved: ' + file);
    return file;
  } catch (err) {
    logger.error('backupMemory error: ' + err.message);
    return null;
  }
}

module.exports = {
  saveFact,
  updateFact,
  deleteFact,
  loadProfile,
  loadTasks,
  updateTask,
  deleteTask,
  purgeExpiredFacts,
  backupMemory
};
