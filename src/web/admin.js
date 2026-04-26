const express = require('express');
const path = require('path');
const logger = require('../utils/logger');
const { getActionHistory, getPendingActions } = require('../modules/agent');
const { loadTasks } = require('../modules/memory');
const { backupMemory } = require('../modules/memory');
const { listGenerated } = require('../modules/generator');

const ADMIN_PORT = 3000;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'ibrabot-admin-token';

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

function auth(req, res, next) {
  const token = req.headers['x-admin-token'] || req.query.token;
  if (token !== ADMIN_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized. Set X-Admin-Token header.' });
  }
  next();
}

app.get('/', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Ibrabot Admin</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', sans-serif; background: #0f172a; color: #e2e8f0; min-height: 100vh; }
  header { background: #1e293b; padding: 1rem 2rem; border-bottom: 1px solid #334155; display: flex; align-items: center; gap: 1rem; }
  header h1 { font-size: 1.5rem; color: #38bdf8; }
  header span { font-size: 0.85rem; color: #94a3b8; }
  .container { max-width: 1100px; margin: 0 auto; padding: 2rem; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 1.5rem; margin-top: 1.5rem; }
  .card { background: #1e293b; border-radius: 12px; padding: 1.5rem; border: 1px solid #334155; }
  .card h2 { font-size: 1rem; color: #94a3b8; margin-bottom: 1rem; text-transform: uppercase; letter-spacing: 0.05em; }
  .stat { font-size: 2.5rem; font-weight: bold; color: #38bdf8; }
  .badge { display: inline-block; padding: 0.2rem 0.6rem; border-radius: 999px; font-size: 0.75rem; font-weight: 600; }
  .badge-pending { background: #f59e0b22; color: #f59e0b; }
  .badge-approved { background: #10b98122; color: #10b981; }
  .badge-rejected { background: #ef444422; color: #ef4444; }
  .log-line { font-size: 0.75rem; font-family: monospace; color: #94a3b8; padding: 0.2rem 0; border-bottom: 1px solid #1e293b; word-break: break-all; }
  .btn { display: inline-block; padding: 0.5rem 1.2rem; border-radius: 8px; font-size: 0.9rem; cursor: pointer; border: none; font-weight: 600; }
  .btn-primary { background: #38bdf8; color: #0f172a; }
  .btn-danger { background: #ef4444; color: white; }
  .action-row { display: flex; align-items: center; gap: 0.5rem; padding: 0.5rem 0; border-bottom: 1px solid #334155; font-size: 0.85rem; }
  #token-form { margin-bottom: 2rem; display: flex; gap: 0.5rem; }
  #token-form input { flex: 1; background: #0f172a; border: 1px solid #334155; color: #e2e8f0; padding: 0.5rem 1rem; border-radius: 8px; font-size: 0.9rem; }
  .section-title { font-size: 1.2rem; font-weight: 700; color: #e2e8f0; margin: 2rem 0 1rem; }
  #status { color: #10b981; font-size: 0.85rem; margin-top: 0.5rem; }
</style>
</head>
<body>
<header>
  <h1>🤖 Ibrabot Admin</h1>
  <span>Panel de control del agente</span>
</header>
<div class="container">
  <div id="token-form">
    <input type="password" id="token" placeholder="Admin token (ADMIN_TOKEN secret)" />
    <button class="btn btn-primary" onclick="loadData()">Conectar</button>
  </div>
  <div id="status"></div>

  <div class="grid" id="stats"></div>

  <div class="section-title">Acciones pendientes</div>
  <div id="pending"></div>

  <div class="section-title">Historial de acciones</div>
  <div id="history"></div>

  <div class="section-title">Logs del agente</div>
  <div id="logs" style="max-height:300px;overflow-y:auto;background:#0f172a;border-radius:8px;padding:1rem;"></div>
</div>

<script>
let TOKEN = '';

function getToken() { return document.getElementById('token').value.trim(); }

async function apiFetch(path) {
  TOKEN = getToken();
  const res = await fetch(path, { headers: { 'X-Admin-Token': TOKEN } });
  if (!res.ok) { document.getElementById('status').textContent = 'Error: ' + res.status; return null; }
  return res.json();
}

async function loadData() {
  document.getElementById('status').textContent = 'Cargando...';
  const [overview, pending, history, logs] = await Promise.all([
    apiFetch('/api/overview'),
    apiFetch('/api/pending'),
    apiFetch('/api/history'),
    apiFetch('/api/logs')
  ]);
  if (!overview) return;

  document.getElementById('status').textContent = '✅ Conectado';

  document.getElementById('stats').innerHTML = \`
    <div class="card"><h2>Acciones Pendientes</h2><div class="stat">\${pending?.length || 0}</div></div>
    <div class="card"><h2>Apps Generadas</h2><div class="stat">\${overview.generated || 0}</div></div>
    <div class="card"><h2>Integraciones</h2><div>\${overview.integrations.map(i => '<span class="badge badge-approved">'+i+'</span>').join(' ') || '—'}</div></div>
  \`;

  document.getElementById('pending').innerHTML = (pending || []).length === 0
    ? '<p style="color:#64748b">No hay acciones pendientes.</p>'
    : (pending || []).map(a => \`
      <div class="action-row">
        <span class="badge badge-pending">PENDING</span>
        <strong>\${a.action}</strong> — <span style="color:#94a3b8">\${a.payload}</span>
        <button class="btn btn-primary" style="margin-left:auto" onclick="resolve(\${a.id},true)">✅ Aprobar</button>
        <button class="btn btn-danger" onclick="resolve(\${a.id},false)">❌ Rechazar</button>
      </div>
    \`).join('');

  document.getElementById('history').innerHTML = (history || []).map(a => \`
    <div class="action-row">
      <span class="badge badge-\${a.status}">\${a.status.toUpperCase()}</span>
      <strong>\${a.action}</strong> — <span style="color:#94a3b8">\${a.payload?.slice(0,80)}</span>
      <span style="margin-left:auto;color:#64748b;font-size:0.75rem">\${new Date(a.createdAt).toLocaleString()}</span>
    </div>
  \`).join('');

  document.getElementById('logs').innerHTML = (logs || []).map(l => \`<div class="log-line">\${l}</div>\`).join('');
}

async function resolve(id, approve) {
  TOKEN = getToken();
  await fetch(\`/api/action/\${id}/resolve\`, {
    method: 'POST',
    headers: { 'X-Admin-Token': TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ approve })
  });
  loadData();
}
</script>
</body>
</html>
  `);
});

app.get('/api/overview', auth, async (req, res) => {
  try {
    const generated = listGenerated();
    const integrations = [];
    if (process.env.CANVA_API_KEY) integrations.push('Canva');
    if (process.env.WHATSAPP_TOKEN) integrations.push('WhatsApp');

    res.json({ generated: generated.length, integrations });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/pending', auth, async (req, res) => {
  try {
    const rows = await getPendingActions();
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/history', auth, async (req, res) => {
  try {
    const rows = await getActionHistory(30);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/logs', auth, (req, res) => {
  try {
    const logs = logger.getLogs(100);
    res.json(logs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/action/:id/resolve', auth, async (req, res) => {
  try {
    const { id } = req.params;
    const { approve } = req.body;
    const agent = require('../modules/agent');
    const result = await agent.resolveAction(parseInt(id), approve === true || approve === 'true', null, req.query.userId);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/backup', auth, async (req, res) => {
  try {
    const file = await backupMemory();
    res.json({ ok: true, file });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function start() {
  app.listen(ADMIN_PORT, 'localhost', () => {
    logger.success(`Admin panel running on http://localhost:${ADMIN_PORT}`);
  });
}

module.exports = { start };
