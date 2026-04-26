const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

const MEMORY_FILE = path.join(__dirname, '../../memory.json');
const MAX_HISTORY = 20;

let memory = {};

try {
  if (fs.existsSync(MEMORY_FILE)) {
    memory = JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf8'));
  }
} catch {
  memory = {};
}

function save() {
  try {
    fs.writeFileSync(MEMORY_FILE, JSON.stringify(memory, null, 2));
  } catch (err) {
    logger.error('Error guardando historial: ' + err.message);
  }
}

function add(userId, role, content) {
  try {
    if (!memory[userId]) memory[userId] = [];
    memory[userId].push({ role, content, ts: Date.now() });
    if (memory[userId].length > MAX_HISTORY) {
      memory[userId] = memory[userId].slice(-MAX_HISTORY);
    }
    save();
  } catch (err) {
    logger.error('Error añadiendo al historial: ' + err.message);
  }
}

function get(userId) {
  return memory[userId] || [];
}

function clear(userId) {
  delete memory[userId];
  save();
}

module.exports = { add, get, clear };
