const { run, all } = require('../core/db');
const logger = require('../utils/logger');

const pendingActions = new Map();

async function requestConfirmation(userId, action, payload, bot) {
  const id = `${userId}_${Date.now()}`;

  const now = Date.now();
  await run(
    `INSERT INTO pending_actions (userId, action, payload, status, createdAt) VALUES (?, ?, ?, 'pending', ?)`,
    [userId, action, JSON.stringify(payload), now]
  );

  const dbRow = await all(
    `SELECT id FROM pending_actions WHERE userId = ? AND action = ? AND status = 'pending' ORDER BY id DESC LIMIT 1`,
    [userId, action]
  );
  const rowId = dbRow[0]?.id;

  pendingActions.set(id, { userId, action, payload, rowId, resolve: null, reject: null });

  logger.action(userId, 'confirm_requested', { action, payload });

  const confirmText = formatActionText(action, payload);
  await bot.sendMessage(
    userId,
    `🤖 *Acción pendiente de confirmación:*\n\n${confirmText}\n\n¿Confirmas? Responde con:\n✅ \`!confirm ${rowId}\`\n❌ \`!cancel ${rowId}\``,
    { parse_mode: 'Markdown' }
  );

  return rowId;
}

function formatActionText(action, payload) {
  switch (action) {
    case 'canva_create_design':
      return `📐 Crear diseño en Canva: *${payload.title || payload.designType}*`;
    case 'whatsapp_send':
      return `📱 Enviar WhatsApp a *${payload.to}*:\n"${payload.text}"`;
    case 'web_search':
      return `🔍 Buscar en la web: *${payload.query}*`;
    case 'generate_app':
      return `⚙️ Generar aplicación *${payload.name}* (tipo: ${payload.type})`;
    case 'memory_backup':
      return `💾 Crear backup de la memoria`;
    default:
      return `Acción: *${action}*\nDatos: ${JSON.stringify(payload)}`;
  }
}

async function resolveAction(rowId, approved, bot, userId) {
  try {
    const rows = await all(`SELECT * FROM pending_actions WHERE id = ?`, [rowId]);
    if (!rows.length) return { ok: false, msg: 'Acción no encontrada.' };

    const row = rows[0];
    if (row.status !== 'pending') return { ok: false, msg: 'Esta acción ya fue procesada.' };

    const status = approved ? 'approved' : 'rejected';
    const now = Date.now();

    await run(
      `UPDATE pending_actions SET status = ?, resolvedAt = ? WHERE id = ?`,
      [status, now, rowId]
    );

    logger.action(userId, approved ? 'action_approved' : 'action_rejected', {
      rowId, action: row.action
    });

    if (approved) {
      return await executeAction(row.action, JSON.parse(row.payload || '{}'), userId, bot);
    }

    return { ok: true, msg: '❌ Acción cancelada.' };
  } catch (err) {
    logger.error('resolveAction error: ' + err.message);
    return { ok: false, msg: 'Error procesando la acción.' };
  }
}

async function executeAction(action, payload, userId, bot) {
  try {
    switch (action) {
      case 'canva_create_design': {
        const canva = require('./integrations/canva');
        if (!canva.isConfigured()) return { ok: false, msg: 'CANVA_API_KEY no configurada.' };
        const result = await canva.createDesign(payload);
        return { ok: true, msg: `✅ Diseño creado en Canva: ${result.design?.id || 'OK'}` };
      }
      case 'whatsapp_send': {
        const wa = require('./integrations/whatsapp');
        if (!wa.isConfigured()) return { ok: false, msg: 'WhatsApp no configurado.' };
        await wa.sendTextMessage(payload.to, payload.text);
        return { ok: true, msg: `✅ WhatsApp enviado a ${payload.to}` };
      }
      case 'generate_app': {
        const gen = require('./generator');
        let dir;
        if (payload.type === 'express') dir = gen.generateExpressApp(payload.name);
        else if (payload.type === 'react') dir = gen.generateReactApp(payload.name);
        else dir = gen.generateFullStack(payload.name);
        return { ok: true, msg: `✅ App generada en: \`${dir}\`` };
      }
      case 'memory_backup': {
        const mem = require('./memory');
        const file = await mem.backupMemory();
        return { ok: true, msg: `✅ Backup guardado: \`${file}\`` };
      }
      default:
        return { ok: false, msg: `Acción desconocida: ${action}` };
    }
  } catch (err) {
    logger.error('executeAction error: ' + err.message);
    return { ok: false, msg: `Error ejecutando acción: ${err.message}` };
  }
}

async function getPendingActions(userId = null) {
  if (userId) {
    return await all(
      `SELECT * FROM pending_actions WHERE userId = ? AND status = 'pending' ORDER BY id DESC`,
      [userId]
    );
  }
  return await all(`SELECT * FROM pending_actions WHERE status = 'pending' ORDER BY id DESC`);
}

async function getActionHistory(limit = 20) {
  return await all(
    `SELECT * FROM pending_actions ORDER BY id DESC LIMIT ?`, [limit]
  );
}

module.exports = { requestConfirmation, resolveAction, getPendingActions, getActionHistory };
