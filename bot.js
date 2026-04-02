require('dotenv').config();
const fs = require('fs');
const path = require('path');
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const sqlite3 = require('sqlite3').verbose();
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
ffmpeg.setFfmpegPath(ffmpegPath);

// =========================
// CONFIGURACIÓN
// =========================

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

if (!TELEGRAM_TOKEN || !OPENROUTER_API_KEY) {
  console.error("❌ ERROR: Faltan variables de entorno.");
  process.exit(1);
}

const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

// =========================
// BASE DE DATOS SQLITE (CON SEGURIDAD)
// =========================

let db;

try {
  db = new sqlite3.Database('memory.db', (err) => {
    if (err) console.error("❌ Error abriendo SQLite:", err.message);
    else console.log("📦 SQLite cargado correctamente.");
  });
} catch (err) {
  console.error("❌ Error crítico con SQLite:", err.message);
}

// Crear tabla segura
db.run(`
  CREATE TABLE IF NOT EXISTS memory (
    userId TEXT,
    key TEXT,
    value TEXT
  )
`);

// Guardar memoria permanente
function saveFact(userId, key, value) {
  try {
    db.run(
      `INSERT INTO memory (userId, key, value) VALUES (?, ?, ?)`,
      [userId, key, value]
    );
  } catch (err) {
    console.error("❌ Error guardando memoria:", err.message);
  }
}

// Leer memoria permanente
function loadFacts(userId) {
  return new Promise((resolve) => {
    try {
      db.all(
        `SELECT key, value FROM memory WHERE userId = ?`,
        [userId],
        (err, rows) => {
          if (err) return resolve({});
          const profile = {};
          rows.forEach(r => {
            if (!profile[r.key]) profile[r.key] = [];
            profile[r.key].push(r.value);
          });
          resolve(profile);
        }
      );
    } catch (err) {
      console.error("❌ Error leyendo memoria:", err.message);
      resolve({});
    }
  });
}

// =========================
// HISTORIAL CORTO
// =========================

const MEMORY_FILE = path.join(__dirname, "memory.json");
let memory = {};

try {
  if (fs.existsSync(MEMORY_FILE)) {
    memory = JSON.parse(fs.readFileSync(MEMORY_FILE, "utf8"));
  }
} catch {
  memory = {};
}

function saveMemory() {
  try {
    fs.writeFileSync(MEMORY_FILE, JSON.stringify(memory, null, 2));
  } catch (err) {
    console.error("❌ Error guardando historial:", err.message);
  }
}

function addToMemory(userId, role, content) {
  try {
    if (!memory[userId]) memory[userId] = [];
    memory[userId].push({ role, content, ts: Date.now() });
    if (memory[userId].length > 20) memory[userId] = memory[userId].slice(-20);
    saveMemory();
  } catch (err) {
    console.error("❌ Error añadiendo al historial:", err.message);
  }
}

function getUserHistory(userId) {
  return memory[userId] || [];
}

// =========================
// ANTI‑SPAM
// =========================

const spamControl = {};
const SPAM_INTERVAL = 3000;
const SPAM_LIMIT = 3;

function isSpam(userId) {
  const now = Date.now();

  if (!spamControl[userId]) {
    spamControl[userId] = { lastMessageTime: now, count: 1 };
    return false;
  }

  const diff = now - spamControl[userId].lastMessageTime;

  if (diff < SPAM_INTERVAL) {
    spamControl[userId].count++;
  } else {
    spamControl[userId].count = 1;
  }

  spamControl[userId].lastMessageTime = now;

  return spamControl[userId].count > SPAM_LIMIT;
}

// =========================
// INTERPRETACIÓN DE TEXTO (CON SEGURIDAD)
// =========================

async function interpretarTexto(textoOriginal) {
  try {
    const response = await axios.post(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        model: "openai/gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `
Eres un módulo de corrección inteligente.
Corrige errores, interpreta frases incompletas y devuelve el texto claro.
No expliques nada.
`.trim()
          },
          { role: "user", content: textoOriginal }
        ]
      },
      {
        headers: {
          Authorization: `Bearer ${OPENROUTER_API_KEY}`,
          "Content-Type": "application/json"
        },
        timeout: 15000
      }
    );

    return response.data.choices[0].message.content.trim();
  } catch (err) {
    console.error("⚠️ Error interpretando texto:", err.message);
    return textoOriginal;
  }
}

// =========================
// OPENROUTER (CON REINTENTOS)
// =========================

async function askOpenRouter(userId, userMessage) {
  const profile = await loadFacts(userId);

  const messages = [
    {
      role: "system",
      content: `
Eres Ibrabot, un asistente personal avanzado.
Tienes memoria permanente del usuario.
Usa esa memoria para responder mejor.
`.trim()
    },
    { role: "system", content: `Datos del usuario: ${JSON.stringify(profile)}` },
    ...getUserHistory(userId),
    { role: "user", content: userMessage }
  ];

  try {
    const response = await axios.post(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        model: "openai/gpt-4o-mini",
        messages
      },
      {
        headers: {
          Authorization: `Bearer ${OPENROUTER_API_KEY}`,
          "Content-Type": "application/json"
        },
        timeout: 20000
      }
    );

    return response.data.choices[0].message.content;
  } catch (err) {
    console.error("⚠️ Error OpenRouter:", err.message);

    return "Estoy teniendo un pequeño problema técnico, pero sigo aquí contigo.";
  }
}

// =========================
// VOZ → TEXTO (CON SEGURIDAD)
// =========================

async function transcribeVoice(fileUrl) {
  try {
    const oggPath = path.join(__dirname, "voice.ogg");
    const mp3Path = path.join(__dirname, "voice.mp3");

    const audio = await axios.get(fileUrl, { responseType: "arraybuffer" });
    fs.writeFileSync(oggPath, audio.data);

    await new Promise((resolve, reject) => {
      ffmpeg(oggPath)
        .toFormat("mp3")
        .save(mp3Path)
        .on("end", resolve)
        .on("error", reject);
    });

    const base64Audio = fs.readFileSync(mp3Path).toString("base64");

    const whisper = await axios.post(
      "https://openrouter.ai/api/v1/audio/transcriptions",
      {
        model: "openai/whisper-1",
        file: base64Audio,
        format: "mp3"
      },
      {
        headers: {
          Authorization: `Bearer ${OPENROUTER_API_KEY}`,
          "Content-Type": "application/json"
        }
      }
    );

    fs.unlinkSync(oggPath);
    fs.unlinkSync(mp3Path);

    return whisper.data.text;
  } catch (err) {
    console.error("⚠️ Error transcribiendo voz:", err.message);
    return "";
  }
}

// =========================
// MANEJO DE MENSAJES (A PRUEBA DE FALLOS)
// =========================

bot.on("message", async (msg) => {
  try {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    if (!msg.text && !msg.voice) return;

    if (isSpam(userId)) {
      return bot.sendMessage(chatId, "Estás enviando mensajes demasiado rápido.");
    }

    if (msg.voice) {
      const file = await bot.getFile(msg.voice.file_id);
      const fileUrl = `https://api.telegram.org/file/bot${TELEGRAM_TOKEN}/${file.file_path}`;
      const text = await transcribeVoice(fileUrl);

      const textoInterpretado = await interpretarTexto(text);
      const reply = await askOpenRouter(userId, textoInterpretado);

      addToMemory(userId, "user", text);
      addToMemory(userId, "assistant", reply);

      return bot.sendMessage(chatId, reply);
    }

    if (msg.text) {
      extractFacts(userId, msg.text);
      addToMemory(userId, "user", msg.text);

      const textoInterpretado = await interpretarTexto(msg.text);
      const reply = await askOpenRouter(userId, textoInterpretado);

      addToMemory(userId, "assistant", reply);

      return bot.sendMessage(chatId, reply);
    }
  } catch (err) {
    console.error("❌ ERROR GLOBAL:", err.message);
  }
});

console.log("🛡️ Ibrabot listo con ESTABILIDAD TOTAL (Paso 1 completado).");
