require('dotenv').config();
const fs = require('fs');
const path = require('path');
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
ffmpeg.setFfmpegPath(ffmpegPath);

// =========================
// CONFIGURACIÓN
// =========================

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

if (!TELEGRAM_TOKEN || !OPENROUTER_API_KEY) {
  console.error("Faltan variables de entorno.");
  process.exit(1);
}

const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

// =========================
// MEMORIA AVANZADA
// =========================

const PROFILE_FILE = path.join(__dirname, "profile.json");
let profiles = {};

function loadProfiles() {
  try {
    if (fs.existsSync(PROFILE_FILE)) {
      profiles = JSON.parse(fs.readFileSync(PROFILE_FILE, "utf8"));
    }
  } catch {
    profiles = {};
  }
}

function saveProfiles() {
  fs.writeFileSync(PROFILE_FILE, JSON.stringify(profiles, null, 2));
}

function updateProfile(userId, key, value) {
  if (!profiles[userId]) profiles[userId] = {};
  profiles[userId][key] = value;
  saveProfiles();
}

// Detecta información importante en el mensaje
function extractFacts(userId, text) {
  text = text.toLowerCase();

  if (text.includes("me llamo")) {
    const name = text.split("me llamo")[1].trim().split(" ")[0];
    updateProfile(userId, "name", name);
  }

  if (text.includes("mi cumpleaños es")) {
    const birthday = text.split("mi cumpleaños es")[1].trim();
    updateProfile(userId, "birthday", birthday);
  }

  if (text.includes("vivo en")) {
    const place = text.split("vivo en")[1].trim();
    updateProfile(userId, "location", place);
  }

  if (text.includes("me gusta")) {
    const like = text.split("me gusta")[1].trim();
    if (!profiles[userId].likes) profiles[userId].likes = [];
    profiles[userId].likes.push(like);
    saveProfiles();
  }
}

// =========================
// MEMORIA DE HISTORIAL
// =========================

const MEMORY_FILE = path.join(__dirname, "memory.json");
let memory = {};

function loadMemory() {
  try {
    if (fs.existsSync(MEMORY_FILE)) {
      memory = JSON.parse(fs.readFileSync(MEMORY_FILE, "utf8"));
    }
  } catch {
    memory = {};
  }
}

function saveMemory() {
  fs.writeFileSync(MEMORY_FILE, JSON.stringify(memory, null, 2));
}

function addToMemory(userId, role, content) {
  if (!memory[userId]) memory[userId] = [];
  memory[userId].push({ role, content, ts: Date.now() });
  if (memory[userId].length > 20) memory[userId] = memory[userId].slice(-20);
  saveMemory();
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
// OPENROUTER
// =========================

async function askOpenRouter(userId, userMessage) {
  const profile = profiles[userId] || {};

  const messages = [
    {
      role: "system",
      content: `
Eres Ibrabot, un asistente personal avanzado.
Recuerdas datos importantes del usuario:
- nombre
- gustos
- cumpleaños
- ciudad
- información personal
Usa esa memoria para responder mejor.
No menciones que usas memoria ni detalles técnicos.
`.trim()
    },
    {
      role: "system",
      content: `Datos del usuario: ${JSON.stringify(profile)}`
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
        }
      }
    );

    return response.data?.choices?.[0]?.message?.content || "No pude responder.";
  } catch (err) {
    console.error("Error OpenRouter:", err.message);
    return "Error procesando tu mensaje.";
  }
}

// =========================
// VOZ → TEXTO
// =========================

async function transcribeVoice(fileUrl) {
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
}

// =========================
// MANEJO DE MENSAJES
// =========================

loadMemory();
loadProfiles();

bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  if (isSpam(userId)) {
    return bot.sendMessage(chatId, "Estás enviando mensajes demasiado rápido.");
  }

  if (msg.voice) {
    const file = await bot.getFile(msg.voice.file_id);
    const fileUrl = `https://api.telegram.org/file/bot${TELEGRAM_TOKEN}/${file.file_path}`;
    const text = await transcribeVoice(fileUrl);

    extractFacts(userId, text);
    addToMemory(userId, "user", text);

    const reply = await askOpenRouter(userId, text);
    addToMemory(userId, "assistant", reply);

    return bot.sendMessage(chatId, reply);
  }

  if (msg.text) {
    extractFacts(userId, msg.text);
    addToMemory(userId, "user", msg.text);

    const reply = await askOpenRouter(userId, msg.text);
    addToMemory(userId, "assistant", reply);

    return bot.sendMessage(chatId, reply);
  }
});

console.log("Ibrabot listo con memoria avanzada tipo ChatGPT.");
