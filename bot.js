require('dotenv').config();

const logger = require('./src/utils/logger');

if (!process.env.TELEGRAM_TOKEN || !process.env.OPENROUTER_API_KEY) {
  logger.error('Faltan variables de entorno: TELEGRAM_TOKEN y OPENROUTER_API_KEY son obligatorias.');
  process.exit(1);
}

const TelegramBot = require('node-telegram-bot-api');
const shortMemory = require('./src/core/shortMemory');
const spamControl = require('./src/core/spamControl');
const scheduler = require('./src/core/scheduler');
const memory = require('./src/modules/memory');
const ai = require('./src/modules/ai');
const tasks = require('./src/modules/tasks');
const voice = require('./src/modules/voice');
const web = require('./src/modules/web');
const agent = require('./src/modules/agent');
const generator = require('./src/modules/generator');
const admin = require('./src/web/admin');

const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });

const pendingTime = {};

// =========================
// INIT
// =========================

scheduler.init(bot, memory.loadTasks);
admin.start();

logger.success('⚡ Ibrabot PRO listo: memoria avanzada + voz + web + integraciones + agente autónomo.');

// =========================
// DETECTOR DE PREGUNTAS DE MEMORIA
// =========================

function detectarTipoPregunta(texto) {
  const t = (texto || '').toLowerCase();
  if (t.includes('cómo se llama mi madre') || t.includes('como se llama mi madre')) return 'madre';
  if (t.includes('cuál es mi comida favorita') || t.includes('cual es mi comida favorita')) return 'comida';
  if ((t.includes('como me llamo') || t.includes('cómo me llamo')) && (t.includes('dónde vivo') || t.includes('donde vivo'))) return 'nombre_ciudad';
  if (t.includes('cómo me llamo') || t.includes('como me llamo')) return 'nombre';
  if (t.includes('dónde vivo') || t.includes('donde vivo')) return 'ciudad';
  if (t.includes('en qué proyecto estoy') || t.includes('en que proyecto estoy')) return 'proyecto';
  return null;
}

function responderDesdeMemoria(tipo, deepProfile) {
  const p = deepProfile || {};
  const get = (cat, key) => p[cat] && p[cat][key] && p[cat][key][p[cat][key].length - 1];

  const nombre = get('personas', 'nombre_usuario') || get('personas', 'nombre');
  const ciudad = get('lugares', 'ciudad') || get('lugares', 'residencia');
  const madre = get('personas', 'madre') || get('personas', 'nombre_madre');
  const comida = get('gustos', 'comida_favorita');
  const proyecto = get('proyectos', 'proyecto_actual');

  switch (tipo) {
    case 'madre': return madre ? `Tu madre se llama ${madre}.` : 'No tengo registrado el nombre de tu madre.';
    case 'comida': return comida ? `Tu comida favorita es ${comida}.` : 'No tengo registrada tu comida favorita.';
    case 'nombre_ciudad':
      if (nombre && ciudad) return `Te llamas ${nombre} y vives en ${ciudad}.`;
      if (nombre) return `Te llamas ${nombre}, pero no tengo registrada tu ciudad.`;
      if (ciudad) return `Vives en ${ciudad}, pero no tengo registrado tu nombre.`;
      return 'No tengo registrado ni tu nombre ni tu ciudad.';
    case 'nombre': return nombre ? `Te llamas ${nombre}.` : 'No tengo registrado tu nombre.';
    case 'ciudad': return ciudad ? `Vives en ${ciudad}.` : 'No tengo registrada tu ciudad.';
    case 'proyecto': return proyecto ? `Estás trabajando en ${proyecto}.` : 'No tengo registrado tu proyecto actual.';
    default: return null;
  }
}

// =========================
// COMANDOS ESPECIALES
// =========================

async function handleSpecialCommands(userId, text, chatId) {
  const t = text.trim();

  // Confirmaciones de agente
  const confirmMatch = t.match(/^!confirm\s+(\d+)$/i);
  if (confirmMatch) {
    const id = parseInt(confirmMatch[1]);
    const result = await agent.resolveAction(id, true, bot, userId);
    await bot.sendMessage(chatId, result.msg, { parse_mode: 'Markdown' });
    return true;
  }

  const cancelMatch = t.match(/^!cancel\s+(\d+)$/i);
  if (cancelMatch) {
    const id = parseInt(cancelMatch[1]);
    const result = await agent.resolveAction(id, false, bot, userId);
    await bot.sendMessage(chatId, result.msg, { parse_mode: 'Markdown' });
    return true;
  }

  // Búsqueda web con confirmación
  const searchMatch = t.match(/^!buscar\s+(.+)$/i);
  if (searchMatch) {
    const query = searchMatch[1].trim();
    await agent.requestConfirmation(userId, 'web_search', { query }, bot);
    return true;
  }

  // Leer página web
  const fetchMatch = t.match(/^!leer\s+(https?:\/\/.+)$/i);
  if (fetchMatch) {
    const url = fetchMatch[1].trim();
    await bot.sendMessage(chatId, '🔍 Leyendo página...');
    try {
      const result = await web.summarizePage(url);
      const msg = `*${result.title}*\n\n${result.description || ''}\n\n${result.text.slice(0, 800)}...`;
      await bot.sendMessage(chatId, msg, { parse_mode: 'Markdown' });
    } catch (err) {
      await bot.sendMessage(chatId, `❌ No pude leer esa página: ${err.message}`);
    }
    return true;
  }

  // Generador de apps
  const genMatch = t.match(/^!generar\s+(express|react|fullstack)\s+(.+)$/i);
  if (genMatch) {
    const type = genMatch[1].toLowerCase();
    const name = genMatch[2].trim().replace(/\s+/g, '-').toLowerCase();
    await agent.requestConfirmation(userId, 'generate_app', { type, name }, bot);
    return true;
  }

  // Backup de memoria
  if (t === '!backup') {
    await agent.requestConfirmation(userId, 'memory_backup', {}, bot);
    return true;
  }

  // Pendientes
  if (t === '!pendientes') {
    const pending = await agent.getPendingActions(userId);
    if (!pending.length) {
      await bot.sendMessage(chatId, 'No tienes acciones pendientes de confirmación.');
      return true;
    }
    const msg = pending.map(p => `[${p.id}] *${p.action}* — ${p.payload}`).join('\n');
    await bot.sendMessage(chatId, `*Acciones pendientes:*\n\n${msg}`, { parse_mode: 'Markdown' });
    return true;
  }

  // Lista de comandos
  if (t === '!ayuda' || t === '/start' || t === '/help') {
    await bot.sendMessage(chatId, `*Ibrabot PRO — Comandos disponibles:*

🔍 *Búsqueda y web*
• \`!buscar <consulta>\` — Busca en la web (pide confirmación)
• \`!leer <url>\` — Extrae y resume el contenido de una página

⚙️ *Generador de apps*
• \`!generar express <nombre>\` — Scaffold Node/Express
• \`!generar react <nombre>\` — Scaffold React + Vite
• \`!generar fullstack <nombre>\` — Scaffold API + UI

💾 *Memoria y datos*
• \`!backup\` — Crea un backup de tu memoria

✅ *Control del agente*
• \`!confirm <id>\` — Confirma una acción pendiente
• \`!cancel <id>\` — Cancela una acción pendiente
• \`!pendientes\` — Lista tus acciones pendientes

📋 *Tareas*
• "Tengo que..." / "Debo..." — Guarda una tarea
• "¿Qué tengo hoy?" — Lista tareas de hoy
• "¿Qué tengo mañana?" — Lista tareas de mañana
• "Mis tareas" — Todas las tareas pendientes`, { parse_mode: 'Markdown' });
    return true;
  }

  return false;
}

// =========================
// MENSAJE DE TEXTO
// =========================

bot.on('message', async (msg) => {
  if (!msg.text && !msg.voice) return;

  const chatId = msg.chat.id;
  const userId = String(msg.from.id);

  if (spamControl.isSpam(userId)) {
    await bot.sendMessage(chatId, '⏱ Vas muy rápido, espera un momento.');
    return;
  }

  try {
    // Voz
    if (msg.voice) {
      await bot.sendChatAction(chatId, 'typing');
      const transcript = await voice.processVoiceMessage(bot, msg.voice.file_id);
      if (!transcript) {
        await bot.sendMessage(chatId, '❌ No pude transcribir el audio. Intenta de nuevo.');
        return;
      }
      await bot.sendMessage(chatId, `🎙 *Transcripción:* ${transcript}`, { parse_mode: 'Markdown' });

      msg.text = transcript;
    }

    const userText = msg.text.trim();
    logger.action(userId, 'message', { preview: userText.slice(0, 60) });

    // Comandos especiales
    const handled = await handleSpecialCommands(userId, userText, chatId);
    if (handled) return;

    await bot.sendChatAction(chatId, 'typing');

    // Resolver hora pendiente
    if (pendingTime[userId]) {
      const { accion, fecha, prioridad, baseHora } = pendingTime[userId];
      const t = tasks.normalizarTexto(userText);
      const manana = t.includes('manana') || t.includes('mañana') || t.includes(' am') || t.endsWith('am');
      const tarde = t.includes('tarde') || t.includes('noche') || t.includes(' pm') || t.endsWith('pm');

      if (!manana && !tarde) {
        await bot.sendMessage(chatId, `¿Te refieres a las ${baseHora.h} de la mañana o a las ${baseHora.h} de la tarde?`);
        return;
      }

      let h = baseHora.h;
      if (manana && h === 12) h = 0;
      if (tarde && h < 12) h += 12;

      const horaFinal = `${h.toString().padStart(2, '0')}:${baseHora.m.toString().padStart(2, '0')}`;
      const existingTasks = await memory.loadTasks(userId);
      const match = existingTasks.filter(tk => tk.accion === accion && tk.fecha === fecha);

      if (match.length > 0) {
        match[0].hora = horaFinal;
        await memory.updateTask(match[0]._id, match[0]);
      } else {
        await memory.saveFact(userId, 'tareas', 'tarea', JSON.stringify({
          accion, fecha, hora: horaFinal, prioridad: prioridad || null, estado: 'pendiente'
        }));
      }

      delete pendingTime[userId];
      await bot.sendMessage(chatId, `Perfecto, lo apunto: ${accion} el ${fecha} a las ${horaFinal}.`);
      return;
    }

    // Preguntas de memoria directa
    const tipoPregunta = detectarTipoPregunta(userText);
    if (tipoPregunta) {
      const profile = await memory.loadProfile(userId);
      const directa = responderDesdeMemoria(tipoPregunta, profile);
      if (directa) {
        shortMemory.add(userId, 'user', userText);
        shortMemory.add(userId, 'assistant', directa);
        await bot.sendMessage(chatId, directa);
        return;
      }
    }

    // Comandos de organización
    const comando = tasks.detectarComandoOrganizacion(userText);
    if (comando) {
      const respuesta = await tasks.handleOrganizationCommand(userId, comando);
      shortMemory.add(userId, 'user', userText);
      shortMemory.add(userId, 'assistant', respuesta);
      await bot.sendMessage(chatId, respuesta);
      return;
    }

    // Extracción de tareas
    if (tasks.detectarTarea(userText)) {
      const rawTasks = await ai.extractTasks(userText);
      const pending = await tasks.saveExtractedTasks(userId, rawTasks, userText);

      if (pending && pending.needsTimeConfirmation) {
        pendingTime[userId] = pending;
        await bot.sendMessage(chatId, `¿Te refieres a las ${pending.baseHora.h} de la mañana o de la tarde?`);
      } else {
        shortMemory.add(userId, 'user', userText);
        shortMemory.add(userId, 'assistant', 'Perfecto, lo guardo como tarea.');
        await bot.sendMessage(chatId, 'Perfecto, lo guardo como tarea. 📌');
      }

      // También extrae hechos del texto
      const hechos = await ai.analyzeAndExtractFacts(userText);
      for (const h of hechos) {
        await memory.saveFact(userId, h.categoria, h.clave, h.valor);
      }

      return;
    }

    // Extracción automática de hechos del perfil
    const hechos = await ai.analyzeAndExtractFacts(userText);
    for (const h of hechos) {
      await memory.saveFact(userId, h.categoria, h.clave, h.valor);
    }

    // Respuesta inteligente
    const profile = await memory.loadProfile(userId);
    const history = shortMemory.get(userId);

    shortMemory.add(userId, 'user', userText);
    const respuesta = await ai.smartReply(userId, userText, profile, history);
    shortMemory.add(userId, 'assistant', respuesta);

    await bot.sendMessage(chatId, respuesta);
  } catch (err) {
    logger.error('Handler error: ' + err.message, { userId });
    try {
      await bot.sendMessage(chatId, '❌ Ocurrió un error procesando tu mensaje. Inténtalo de nuevo.');
    } catch {}
  }
});

// =========================
// ERRORES DE POLLING
// =========================

bot.on('polling_error', (err) => {
  logger.error('Polling error: ' + err.message);
});

process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception: ' + err.message);
});

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled rejection: ' + String(reason));
});

process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down...');
  scheduler.stop();
  process.exit(0);
});
