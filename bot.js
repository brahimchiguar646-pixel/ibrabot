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
// SQLITE: MEMORIA PROFUNDA
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

db.run(`
  CREATE TABLE IF NOT EXISTS deep_memory (
    userId TEXT,
    category TEXT,
    key TEXT,
    value TEXT,
    updatedAt INTEGER
  )
`);

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
// LECTURA DE TAREAS DESDE SQLITE
// =========================

function loadTasks(userId) {
  return new Promise((resolve) => {
    try {
      db.all(
        `SELECT value FROM deep_memory WHERE userId = ? AND category = 'tareas'`,
        [userId],
        (err, rows) => {
          if (err) {
            console.error("❌ Error leyendo tareas:", err.message);
            return resolve([]);
          }

          const tasks = rows
            .map(r => {
              try {
                return JSON.parse(r.value);
              } catch {
                return null;
              }
            })
            .filter(Boolean);

          resolve(tasks);
        }
      );
    } catch (err) {
      console.error("❌ Error leyendo tareas:", err.message);
      resolve([]);
    }
  });
}

function getTodayDate() {
  const d = new Date();
  return d.toISOString().split("T")[0];
}

function getTomorrowDate() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().split("T")[0];
}

function filterTasksByDate(tasks, date) {
  return tasks.filter(t => t.fecha === date);
}

function sortTasks(tasks) {
  return tasks.sort((a, b) => {
    if (a.hora && b.hora) return a.hora.localeCompare(b.hora);
    return 0;
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
    if (memory[userId].length > 15) memory[userId] = memory[userId].slice(-15);
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
    const trimmed = (textoOriginal || "").trim();
    if (!trimmed) return "";

    const response = await axios.post(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        model: "openai/gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `
Eres un módulo de normalización de texto.
Corriges errores y devuelves el texto claro.
No expliques nada.
`.trim()
          },
          { role: "user", content: trimmed }
        ]
      },
      {
        headers: {
          Authorization: `Bearer ${OPENROUTER_API_KEY}`,
          "Content-Type": "application/json"
        },
        timeout: 8000
      }
    );

    return response.data.choices[0].message.content.trim();
  } catch (err) {
    console.error("⚠️ Error interpretando texto:", err.message);
    return textoOriginal;
  }
}

// =========================
// EXTRACCIÓN DE HECHOS / TAREAS
// =========================

async function analizarYGuardarHechos(userId, texto) {
  try {
    const clean = (texto || "").trim();
    if (!clean) return;

    const response = await axios.post(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        model: "openai/gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `
Eres un módulo de memoria personal especializado en tareas.

Tu trabajo:
- Detectar si el usuario está diciendo una tarea.
- Extraer acción, fecha, hora, prioridad si existe.
- Devolver SOLO un JSON válido.

Formato obligatorio:

{
  "tareas": [
    {
      "accion": "texto claro",
      "fecha": "YYYY-MM-DD o null",
      "hora": "HH:MM o null",
      "prioridad": "alta|media|baja",
      "estado": "pendiente"
    }
  ]
}

Reglas:
- Si no hay tarea, devuelve {"tareas": []}
- Si dice “mañana”, conviértelo a fecha real.
- Si dice “hoy”, usa la fecha actual.
- Si dice “a las 3”, conviértelo a “15:00”.
- No añadas nada fuera del JSON.
`.trim()
          },
          { role: "user", content: clean }
        ]
      },
      {
        headers: {
          Authorization: `Bearer ${OPENROUTER_API_KEY}`,
          "Content-Type": "application/json"
        },
        timeout: 9000
      }
    );

    const raw = response.data.choices[0].message.content.trim();

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      console.error("⚠️ No se pudo parsear JSON de tareas.");
      return;
    }

    if (!parsed.tareas || !Array.isArray(parsed.tareas)) return;

    for (const t of parsed.tareas) {
      if (!t.accion) continue;

      saveDeepFact(
        userId,
        "tareas",
        "tarea",
        JSON.stringify({
          accion: t.accion,
          fecha: t.fecha,
          hora: t.hora,
          prioridad: t.prioridad,
          estado: "pendiente"
        })
      );
    }
  } catch (err) {
    console.error("⚠️ Error analizando tareas:", err.message);
  }
}

// =========================
// DETECTOR DE PREGUNTAS DE MEMORIA
// =========================

function detectarTipoPregunta(texto) {
  const t = (texto || "").toLowerCase();

  if (t.includes("cómo se llama mi madre") || t.includes("como se llama mi madre")) return "madre";
  if (t.includes("cuál es mi comida favorita") || t.includes("cual es mi comida favorita")) return "comida";
  if (t.includes("cómo me llamo y dónde vivo") || (t.includes("como me llamo") && t.includes("dónde vivo")) || (t.includes("como me llamo") && t.includes("donde vivo"))) return "nombre_ciudad";
  if (t.includes("cómo me llamo") || t.includes("como me llamo")) return "nombre";
  if (t.includes("dónde vivo") || t.includes("donde vivo")) return "ciudad";
  if (t.includes("en qué proyecto estoy trabajando") || t.includes("en que proyecto estoy trabajando")) return "proyecto";

  return null;
}

function responderDesdeMemoria(tipo, deepProfile) {
  const p = deepProfile || {};

  const get = (cat, key) =>
    p[cat] && p[cat][key] && p[cat][key][p[cat][key].length - 1];

  const nombre = get("personas", "nombre_usuario") || get("personas", "nombre");
  const ciudad = get("lugares", "ciudad") || get("lugares", "residencia");
  const madre = get("personas", "madre") || get("personas", "nombre_madre");
  const comida = get("gustos", "comida_favorita");
  const proyecto = get("proyectos", "proyecto_actual");

  switch (tipo) {
    case "madre":
      if (madre) return `Tu madre se llama ${madre}.`;
      return "No tengo registrado el nombre de tu madre.";
    case "comida":
      if (comida) return `Tu comida favorita es ${comida}.`;
      return "No tengo registrada tu comida favorita.";
    case "nombre_ciudad":
      if (nombre && ciudad) return `Te llamas ${nombre} y vives en ${ciudad}.`;
      if (nombre && !ciudad) return `Te llamas ${nombre}, pero no tengo registrada tu ciudad de residencia.`;
      if (!nombre && ciudad) return `Vives en ${ciudad}, pero no tengo registrado tu nombre.`;
      return "No tengo registrado ni tu nombre ni tu ciudad de residencia.";
    case "nombre":
      if (nombre) return `Te llamas ${nombre}.`;
      return "No tengo registrado tu nombre.";
    case "ciudad":
      if (ciudad) return `Vives en ${ciudad}.`;
      return "No tengo registrada tu ciudad de residencia.";
    case "proyecto":
      if (proyecto) return `Estás trabajando en ${proyecto}.`;
      return "No tengo registrado en qué proyecto estás trabajando.";
    default:
      return null;
  }
}

// =========================
// DETECTOR DE TAREAS
// =========================

function detectarTarea(texto) {
  const t = (texto || "").toLowerCase();

  const patrones = [
    "tengo que",
    "debo",
    "debería",
    "quiero hacer",
    "mañana",
    "hoy",
    "esta semana",
    "el lunes",
    "el martes",
    "el miércoles",
    "el jueves",
    "el viernes",
    "el sábado",
    "el domingo",
    "a las "
  ];

  return patrones.some(p => t.includes(p));
}

// =========================
// DETECTOR DE COMANDOS DE ORGANIZACIÓN
// =========================

function detectarComandoOrganizacion(texto) {
  const t = (texto || "").toLowerCase();

  if (t.includes("qué tengo hoy") || t.includes("que tengo hoy")) return "hoy";
  if (t.includes("qué tengo mañana") || t.includes("que tengo mañana")) return "mañana";
  if (t.includes("organízame el día") || t.includes("organizame el dia")) return "organizar";
  if (t.includes("qué hago primero") || t.includes("que hago primero")) return "primero";
  if (t.includes("mis tareas") || t.includes("tareas pendientes")) return "todas";

  return null;
}

// =========================
// OPENROUTER — RESPUESTA INTELIGENTE (EXPERTO PREMIUM)
// =========================

async function askOpenRouter(userId, userMessage) {
  const deepProfile = await loadDeepProfile(userId);

  // 1) Detectar si es una pregunta de memoria directa
  const tipo = detectarTipoPregunta(userMessage);
  if (tipo) {
    const directa = responderDesdeMemoria(tipo, deepProfile);
    if (directa) return directa;
  }

  // 2) Detectar si el mensaje es una tarea
  if (detectarTarea(userMessage)) {
    return "Perfecto, lo guardo como tarea.";
  }

  // 3) Comandos de organización
  const comando = detectarComandoOrganizacion(userMessage);
  if (comando) {
    const tasks = await loadTasks(userId);

    if (comando === "hoy") {
      const hoy = getTodayDate();
      const lista = sortTasks(filterTasksByDate(tasks, hoy));

      if (lista.length === 0) return "Hoy no tienes tareas registradas.";

      let out = "Tus tareas de hoy:\n";
      lista.forEach(t => {
        out += `• ${t.accion}${t.hora ? " a las " + t.hora : ""}\n`;
      });
      return out;
    }

    if (comando === "mañana") {
      const mañana = getTomorrowDate();
      const lista = sortTasks(filterTasksByDate(tasks, mañana));

      if (lista.length === 0) return "Mañana no tienes tareas registradas.";

      let out = "Tus tareas de mañana:\n";
      lista.forEach(t => {
        out += `• ${t.accion}${t.hora ? " a las " + t.hora : ""}\n`;
      });
      return out;
    }

    if (comando === "organizar") {
      const hoy = getTodayDate();
      const lista = sortTasks(filterTasksByDate(tasks, hoy));

      if (lista.length === 0) return "Hoy no tienes tareas para organizar.";

      let out = "Plan para hoy:\n";
      lista.forEach((t, i) => {
        out += `${i + 1}. ${t.accion}${t.hora ? " a las " + t.hora : ""}\n`;
      });
      return out;
    }

    if (comando === "primero") {
      const hoy = getTodayDate();
      const lista = sortTasks(filterTasksByDate(tasks, hoy));

      if (lista.length === 0) return "Hoy no tienes tareas.";

      const primera = lista[0];
      return `Lo primero que debes hacer hoy es: ${primera.accion}${primera.hora ? " a las " + primera.hora : ""}.`;
    }

    if (comando === "todas") {
      if (tasks.length === 0) return "No tienes tareas registradas.";

      let out = "Tus tareas pendientes:\n";
      tasks.forEach(t => {
        out += `• ${t.accion}${t.fecha ? " (" + t.fecha + ")" : ""}${t.hora ? " a las " + t.hora : ""}\n`;
      });
      return out;
    }
  }

  const messages = [
    {
      role: "system",
      content: `
Eres Ibrabot, un asistente profesional experto que acompaña al usuario en su día a día.

OBJETIVO GENERAL:
- Ayudar al usuario a pensar mejor, decidir mejor y organizar mejor su vida y sus proyectos.
- Actuar como un "jefe de operaciones" personal: priorizas, estructuras, propones planes y siguientes pasos.

REGLAS DE IDENTIDAD:
- Siempre hablas DESDE la perspectiva del usuario.
- Usa "tú", "tu madre", "tu comida favorita", "tu ciudad", "tu proyecto".
- NUNCA digas "mi madre", "mi comida favorita", "mi ciudad", "mi proyecto".

MODOS DE RESPUESTA (elige mentalmente el que mejor encaje, pero NO lo nombres):
- Modo PLAN: cuando el usuario quiere avanzar en algo → devuelves pasos claros y ordenados.
- Modo ANÁLISIS: cuando el usuario está bloqueado o confuso → explicas el problema en 3-5 puntos clave.
- Modo PRIORIDADES: cuando el usuario tiene muchas cosas → ordenas qué hacer primero, segundo, tercero.
- Modo IDEAS: cuando el usuario pide creatividad → das ideas concretas, accionables, no genéricas.
- Modo RESUMEN: cuando el usuario te da mucho texto → devuelves lo esencial, sin perder lo importante.
- Modo DECISIÓN: cuando el usuario duda entre opciones → comparas y recomiendas una, explicando por qué.

ESTILO:
- Respuestas cortas, claras y directas.
- Siempre orientadas a la acción: qué hacer ahora, hoy, esta semana.
- Nada de relleno, nada de frases vacías.

USO DE MEMORIA:
- Usa la memoria profunda si existe para adaptar tus respuestas al contexto del usuario (nombre, ciudad, proyectos, gustos).
- Si el usuario pregunta por un dato personal (nombre, ciudad, madre, comida favorita, proyecto),
  responde SIEMPRE de forma directa y concreta usando la memoria.

PROHIBIDO:
- JAMÁS respondas frases genéricas como:
  - "Entiendo, no hay problema."
  - "¿En qué puedo ayudarte hoy?"
  - "Estoy aquí para ayudarte."
  - "No hay problema, si hay algo más..."
- No des respuestas que no aporten nada práctico.

FORMATO RECOMENDADO (cuando tenga sentido):
- 1 frase de contexto máximo.
- Luego lista corta de pasos, prioridades o puntos clave.
- Máximo 6 puntos, salvo que el usuario pida explícitamente más detalle.
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
        timeout: 12000
      }
    );

    const text = response.data.choices[0].message.content.trim();

    const gen = text.toLowerCase();
    const esGenerica =
      gen.includes("en qué puedo ayudarte") ||
      gen.includes("en que puedo ayudarte") ||
      gen.includes("estoy aquí para ayudarte") ||
      gen.includes("estoy aqui para ayudarte") ||
      gen.startsWith("entiendo") ||
      gen.startsWith("no hay problema");

    if (esGenerica && tipo) {
      const directa = responderDesdeMemoria(tipo, deepProfile);
      if (directa) return directa;
    }

    return text;
  } catch (err) {
    console.error("⚠️ Error OpenRouter:", err.message);
    return "Estoy teniendo un pequeño problema técnico, pero sigo contigo.";
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
        },
        timeout: 15000
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

    // VOZ
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

    // TEXTO
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

console.log("⚡ Ibrabot listo: memoria profunda + experto premium + tareas (bloques 1 y 2).");
