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
// BASE DE DATOS SQLITE (MEMORIA PROFUNDA)
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

// Tabla de memoria profunda organizada
db.run(`
  CREATE TABLE IF NOT EXISTS deep_memory (
    userId TEXT,
    category TEXT,
    key TEXT,
    value TEXT,
    updatedAt INTEGER
  )
`);

// Guardar o actualizar un hecho (upsert)
function saveDeepFact(userId, category, key, value) {
  try {
    const now = Date.now();
    db.run(
      `
      INSERT INTO deep_memory (userId, category, key, value, updatedAt)
      VALUES (?, ?, ?, ?, ?)
      `,
      [userId, category, key, value, now]
    );
  } catch (err) {
    console.error("❌ Error guardando memoria profunda:", err.message);
  }
}

// Leer memoria profunda completa del usuario
function loadDeepProfile(userId) {
  return new Promise((resolve) => {
    try {
      db.all(
        `SELECT category, key, value FROM deep_memory WHERE userId = ?`,
        [userId],
        (err, rows) => {
          if (err) {
            console.error("❌ Error leyendo memoria profunda:", err.message);
            return resolve({});
          }
          const profile = {};
          rows.forEach(r => {
            if (!profile[r.category]) profile[r.category] = {};
            if (!profile[r.category][r.key]) profile[r.category][r.key] = [];
            profile[r.category][r.key].push(r.value);
          });
          resolve(profile);
        }
      );
    } catch (err) {
      console.error("❌ Error leyendo memoria profunda:", err.message);
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
// INTERPRETACIÓN DE TEXTO
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
Corriges errores, interpretas frases incompletas y devuelves el texto claro.
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
// EXTRACCIÓN DE HECHOS (MEMORIA PROFUNDA)
// =========================

async function analizarYGuardarHechos(userId, texto) {
  try {
    const response = await axios.post(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        model: "openai/gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `
Eres un módulo de análisis de memoria personal.
Tu tarea:
- Leer el mensaje del usuario.
- Extraer información importante sobre su vida, gustos, proyectos, rutinas, personas, objetivos, lugares, etc.
- Clasificar cada hecho en una categoría.
- Devolver SOLO un JSON con este formato:

{
  "facts": [
    {
      "category": "personas|gustos|proyectos|rutinas|lugares|tareas|objetivos|preferencias|otros",
      "key": "etiqueta_corta_en_snake_case",
      "value": "texto claro con el hecho"
    }
  ]
}

No expliques nada, no añadas texto fuera del JSON.
`.trim()
          },
          {
            role: "user",
            content: texto
          }
        ]
      },
      {
        headers: {
          Authorization: `Bearer ${OPENROUTER_API_KEY}`,
          "Content-Type": "application/json"
        },
        timeout: 20000
      }
    );

    const raw = response.data.choices[0].message.content.trim();

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      console.error("⚠️ No se pudo parsear JSON de memoria profunda.");
      return;
    }

    if (!parsed.facts || !Array.isArray(parsed.facts)) return;

    for (const fact of parsed.facts) {
      if (!fact.category || !fact.key || !fact.value) continue;
      saveDeepFact(userId, fact.category, fact.key, fact.value);
    }
  } catch (err) {
    console.error("⚠️ Error analizando hechos:", err.message);
  }
}

// =========================
// OPENROUTER (USA MEMORIA PROFUNDA)
// =========================

async function askOpenRouter(userId, userMessage) {
  const deepProfile = await loadDeepProfile(userId);

  const messages = [
    {
      role: "system",
      content: `
Eres Ibrabot, un asistente personal avanzado.
Tienes memoria profunda y organizada del usuario.
Debes usar esa memoria para:
- Recordar personas importantes
- Recordar gustos y preferencias
- Recordar proyectos y objetivos
- Recordar rutinas y lugares importantes
- Adaptar tus respuestas a su vida real
No inventes datos nuevos sobre el usuario, solo usa lo que está en la memoria.
`.trim()
    },
    {
      role: "system",
      content: `Memoria profunda del usuario (JSON): ${JSON.stringify(deepProfile)}`
    },
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
// VOZ → TEXTO
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
// MANEJO DE MENSAJES
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

      if (!text) return;

      const textoInterpretado = await interpretarTexto(text);
      await analizarYGuardarHechos(userId, textoInterpretado);

      addToMemory(userId, "user", textoInterpretado);
      const reply = await askOpenRouter(userId, textoInterpretado);
      addToMemory(userId, "assistant", reply);

      return bot.sendMessage(chatId, reply);
    }

    if (msg.text) {
      const textoInterpretado = await interpretarTexto(msg.text);
      await analizarYGuardarHechos(userId, textoInterpretado);

      addToMemory(userId, "user", textoInterpretado);
      const reply = await askOpenRouter(userId, textoInterpretado);
      addToMemory(userId, "assistant", reply);

      return bot.sendMessage(chatId, reply);
    }
  } catch (err) {
    console.error("❌ ERROR GLOBAL:", err.message);
  }
});

console.log("🧠 Ibrabot listo con MEMORIA PROFUNDA ORGANIZADA (Paso 2).");
