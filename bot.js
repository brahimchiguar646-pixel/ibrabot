require('dotenv').config();
const fs = require('fs');
const path = require('path');
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');

// =========================
// CONFIGURACIÓN BÁSICA
// =========================

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

if (!TELEGRAM_TOKEN) {
  console.error('FALTA TELEGRAM_TOKEN en las variables de entorno');
  process.exit(1);
}

if (!OPENROUTER_API_KEY) {
  console.error('FALTA OPENROUTER_API_KEY en las variables de entorno');
  process.exit(1);
}

const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

// =========================
// MEMORIA POR USUARIO
// =========================

const MEMORY_FILE = path.join(__dirname, 'memory.json');
let memory = {};

// Cargar memoria desde disco (si existe)
function loadMemory() {
  try {
    if (fs.existsSync(MEMORY_FILE)) {
      const raw = fs.readFileSync(MEMORY_FILE, 'utf8');
      memory = JSON.parse(raw);
      console.log('Memoria cargada desde memory.json');
    } else {
      memory = {};
      console.log('No había memoria previa, empezando limpio.');
    }
  } catch (err) {
    console.error('Error cargando memoria:', err);
    memory = {};
  }
}

// Guardar memoria en disco
function saveMemory() {
  try {
    fs.writeFileSync(MEMORY_FILE, JSON.stringify(memory, null, 2), 'utf8');
  } catch (err) {
    console.error('Error guardando memoria:', err);
  }
}

// Añadir mensaje a la memoria de un usuario
function addToMemory(userId, role, content) {
  if (!memory[userId]) {
    memory[userId] = [];
  }

  memory[userId].push({
    role,
    content,
    ts: Date.now()
  });

  // Limitar a las últimas 20 entradas por usuario
  if (memory[userId].length > 20) {
    memory[userId] = memory[userId].slice(-20);
  }

  saveMemory();
}

// Obtener historial de un usuario en formato para OpenRouter
function getUserHistory(userId) {
  if (!memory[userId]) return [];

  return memory[userId].map(m => ({
    role: m.role,
    content: m.content
  }));
}

// =========================
// LLAMADA A OPENROUTER
// =========================

async function askOpenRouter(userId, userMessage) {
  const history = getUserHistory(userId);

  const systemPrompt = `
Eres Ibrabot, un asistente personal de Brahim.
Recuerdas el contexto de cada usuario según su historial.
Respondes de forma clara, útil y directa.
Si el usuario habla en español, respondes en español.
Si habla en otro idioma, respondes en ese idioma.
No menciones que usas OpenRouter ni detalles técnicos.
  `.trim();

  const messages = [
    { role: 'system', content: systemPrompt },
    ...history,
    { role: 'user', content: userMessage }
  ];

  try {
    const response = await axios.post(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        model: 'openai/gpt-4o-mini',
        messages
      },
      {
        headers: {
          'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://github.com/brahimchiguar646-pixel/ibrabot',
          'X-Title': 'Ibrabot Telegram Bot'
        },
        timeout: 30000
      }
    );

    const reply =
      response.data?.choices?.[0]?.message?.content ||
      'Lo siento, no pude generar una respuesta ahora mismo.';

    return reply;
  } catch (err) {
    console.error('Error llamando a OpenRouter:', err.response?.data || err.message);
    return 'Ha ocurrido un error al pensar la respuesta. Intenta de nuevo en un momento.';
  }
}

// =========================
// MANEJO DE MENSAJES
// =========================

loadMemory();

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const text = msg.text;

  // Ignorar mensajes sin texto (luego añadimos voz, fotos, etc.)
  if (!text) {
    return;
  }

  console.log(`Mensaje de ${userId}: ${text}`);

  // Guardar mensaje del usuario en memoria
  addToMemory(userId, 'user', text);

  // Indicador de "escribiendo..."
  await bot.sendChatAction(chatId, 'typing');

  // Pedir respuesta inteligente a OpenRouter
  const reply = await askOpenRouter(userId, text);

  // Guardar respuesta del bot en memoria
  addToMemory(userId, 'assistant', reply);

  // Enviar respuesta al usuario
  bot.sendMessage(chatId, reply, {
    parse_mode: 'Markdown'
  }).catch(err => {
    console.error('Error enviando mensaje a Telegram:', err.message);
  });
});

console.log('Ibrabot está corriendo con memoria por usuario y respuestas inteligentes.');

