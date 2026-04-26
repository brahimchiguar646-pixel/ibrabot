const fs = require('fs');
const path = require('path');

const LOG_DIR = path.join(__dirname, '../../logs');
const AUDIT_FILE = path.join(LOG_DIR, 'audit.log');

if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

const LEVELS = { info: '📘', warn: '⚠️', error: '❌', success: '✅', action: '🔧' };

function timestamp() {
  return new Date().toISOString();
}

function write(level, message, meta = {}) {
  const icon = LEVELS[level] || '📋';
  const line = `[${timestamp()}] [${level.toUpperCase()}] ${message}`;
  const full = meta && Object.keys(meta).length ? `${line} | ${JSON.stringify(meta)}` : line;

  console.log(`${icon} ${full}`);

  try {
    fs.appendFileSync(AUDIT_FILE, full + '\n');
  } catch {}
}

function auditAction(userId, action, detail = {}) {
  write('action', `USER:${userId} → ${action}`, detail);
}

module.exports = {
  info: (msg, meta) => write('info', msg, meta),
  warn: (msg, meta) => write('warn', msg, meta),
  error: (msg, meta) => write('error', msg, meta),
  success: (msg, meta) => write('success', msg, meta),
  action: (userId, action, detail) => auditAction(userId, action, detail),
  getLogs(lines = 100) {
    try {
      if (!fs.existsSync(AUDIT_FILE)) return [];
      const all = fs.readFileSync(AUDIT_FILE, 'utf8').split('\n').filter(Boolean);
      return all.slice(-lines);
    } catch {
      return [];
    }
  }
};
