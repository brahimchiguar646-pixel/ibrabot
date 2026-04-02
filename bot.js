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
// MEMORIA POR USUARIO
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

const spamControl = {}; // { userId: { lastMessageTime, count } }
const SPAM_INTERVAL = 3000; // 3 segundos
const SPAM_LIMIT = 3;       // máximo 3 mensajes seguidos

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
  const messages = [
    {
      role: "system",
      content: `
Eres Ibrabot, un asistente personal avanzado.
Recuerdas el historial del usuario.
Respondes claro, útil y en su idioma.
No menciones detalles técnicos.
`.trim()
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
// VOZ → TEXTO (WHISPER)
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

bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  // ANTI‑SPAM
  if (isSpam(userId)) {
    return bot.sendMessage(chatId, "Estás enviando mensajes demasiado rápido. Espera un momento.");
  }

  // VOZ
  if (msg.voice) {
    try {
      await bot.sendChatAction(chatId, "typing");

      const file = await bot.getFile(msg.voice.file_id);
      const fileUrl = `https://api.telegram.org/file/bot${TELEGRAM_TOKEN}/${file.file_path}`;

      const text = await transcribeVoice(fileUrl);

      addToMemory(userId, "user", text);

      const reply = await askOpenRouter(userId, text);
      addToMemory(userId, "assistant", reply);

      return bot.sendMessage(chatId, reply);
    } catch (err) {
      console.error("Error voz:", err);
      return bot.sendMessage(chatId, "Error procesando tu mensaje de voz.");
    }
  }

  // TEXTO
  if (msg.text) {
    addToMemory(userId, "user", msg.text);

    await bot.sendChatAction(chatId, "typing");

    const reply = await askOpenRouter(userId, msg.text);

    addToMemory(userId, "assistant", reply);

    return bot.sendMessage(chatId, reply);
  }
});

console.log("Ibrabot listo con memoria, IA, voz y anti‑spam.");
