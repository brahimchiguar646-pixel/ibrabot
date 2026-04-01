const TelegramBot = require("node-telegram-bot-api");
const axios = require("axios");
const fs = require("fs");

// === CONFIGURACIÓN DESDE VARIABLES DE ENTORNO ===
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_MODEL = "openai/gpt-4o-mini";

// Verificación básica
if (!TELEGRAM_TOKEN || !OPENROUTER_API_KEY) {
  console.error("❌ Faltan TELEGRAM_TOKEN u OPENROUTER_API_KEY en las variables de entorno.");
  process.exit(1);
}

// === CARGAR MEMORIA DESDE DISCO ===
let memory = {};
try {
  memory = JSON.parse(fs.readFileSync("memory.json", "utf8"));
} catch (e) {
  memory = {};
}

// === GUARDAR MEMORIA EN DISCO ===
function saveMemory() {
  fs.writeFileSync("memory.json", JSON.stringify(memory, null, 2));
}

// Iniciar bot
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

console.log("✅ Ibrabot está encendido con memoria persistente...");

// Escuchar mensajes
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const userText = msg.text || "";

  if (!userText.trim()) {
    return bot.sendMessage(chatId, "Envíame un mensaje de texto, por favor.");
  }

  // Crear memoria para este usuario si no existe
  if (!memory[chatId]) {
    memory[chatId] = {
      history: []
    };
  }

  // Guardar mensaje del usuario en la memoria
  memory[chatId].history.push({ role: "user", content: userText });
  saveMemory();

  // Mostrar escribiendo...
  bot.sendChatAction(chatId, "typing");

  try {
    const response = await axios.post(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        model: OPENROUTER_MODEL,
        temperature: 0.7,
        messages: [
          {
            role: "system",
            content:
              "Eres Ibrabot, un asistente profesional, cálido, rápido y muy humano. Tienes memoria por usuario y recuerdas el contexto anterior."
          },
          ...memory[chatId].history
        ]
      },
      {
        headers: {
          "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
          "Content-Type": "application/json"
        }
      }
    );

    const aiMessage = response.data.choices[0].message.content;

    // Guardar respuesta del bot en la memoria
    memory[chatId].history.push({ role: "assistant", content: aiMessage });
    saveMemory();

    await bot.sendMessage(chatId, aiMessage, { parse_mode: "Markdown" });

  } catch (error) {
    console.error("❌ Error:", error?.response?.data || error.message);
    bot.sendMessage(chatId, "Hubo un error procesando tu mensaje.");
  }
});
