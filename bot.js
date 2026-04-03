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
/* SQLITE: MEMORIA PROFUNDA */
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
// TAREAS DESDE SQLITE
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
// PARSEO DE FECHAS Y HORAS
// =========================

function normalizarTextoFechaHora(texto) {
  return (texto || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function parseFechaDesdeTexto(texto) {
  const t = normalizarTextoFechaHora(texto);

  if (t.includes("hoy")) {
    return getTodayDate();
  }

  if (t.includes("mañana") || t.includes("manana")) {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toISOString().split("T")[0];
  }

  if (t.includes("pasado mañana") || t.includes("pasado manana")) {
    const d = new Date();
    d.setDate(d.getDate() + 2);
    return d.toISOString().split("T")[0];
  }

  const dias = {
    "lunes": 1,
    "martes": 2,
    "miercoles": 3,
    "miércoles": 3,
    "jueves": 4,
    "viernes": 5,
    "sabado": 6,
    "sábado": 6,
    "domingo": 0
  };

  for (const nombre in dias) {
    if (t.includes(nombre)) {
      const target = dias[nombre];
      const d = new Date();
      const hoyDia = d.getDay(); // 0 domingo, 1 lunes...

      let diff = target - hoyDia;
      if (diff <= 0) diff += 7;

      d.setDate(d.getDate() + diff);
      return d.toISOString().split("T")[0];
    }
  }

  return null;
}

function parseHoraDesdeTexto(texto) {
  const t = normalizarTextoFechaHora(texto);

  const regex = /(?:a las |alas |a la |a )?(\d{1,2})(?:[:h](\d{2}))?/;
  const match = t.match(regex);
  if (!match) return null;

  let horas = parseInt(match[1], 10);
  let minutos = match[2] ? parseInt(match[2], 10) : 0;

  const tieneManana = t.includes("de la mañana") || t.includes("de la manana") || t.includes("por la mañana") || t.includes("por la manana") || t.includes("am ");
  const tieneTarde = t.includes("de la tarde") || t.includes("por la tarde") || t.includes("pm ") || t.includes("noche");

  if (tieneManana && horas === 12) horas = 0;
  if (tieneTarde && horas < 12) horas += 12;

  if (!tieneManana && !tieneTarde) {
    // Ambiguo → devolvemos null para que el bot pregunte
    return null;
  }

  if (horas < 0 || horas > 23) return null;
  if (minutos < 0 || minutos > 59) return null;

  const hh = horas.toString().padStart(2, "0");
  const mm = minutos.toString().padStart(2, "0");
  return `${hh}:${mm}`;
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
// ESTADO: PENDIENTE DE HORA
// =========================

const pendingTime = {}; // userId -> { accion, fecha, prioridad }

// =========================
// EXTRACCIÓN DE TAREAS (SIN FECHAS INVENTADAS)
// =========================

async function analizarYGuardarHechos(userId, texto) {
  try {
    const clean = (texto || "").trim();
    if (!clean) return;

    // Si el usuario está respondiendo a una pregunta de hora
    if (pendingTime[userId]) {
      const hora = parseHoraDesdeTexto(clean);
      if (!hora) {
        return; // no guardamos nada si sigue ambiguo
      }

      const { accion, fecha, prioridad } = pendingTime[userId];
      delete pendingTime[userId];

      // Evitar duplicados
      const tasks = await loadTasks(userId);
      const existe = tasks.some(t =>
        t.accion === accion &&
        t.fecha === fecha &&
        t.hora === hora
      );
      if (existe) return;

      saveDeepFact(
        userId,
        "tareas",
        "tarea",
        JSON.stringify({
          accion,
          fecha,
          hora,
          prioridad: prioridad || null,
          estado: "pendiente"
        })
      );
      return;
    }

    // 1) Pedimos SOLO acción + texto de fecha/hora
    const response = await axios.post(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        model: "openai/gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `
Eres un módulo de extracción de tareas.

Tu trabajo:
- Detectar si el usuario está diciendo una tarea.
- Extraer:
  - accion: texto claro de lo que hay que hacer
  - fechaTexto: texto tal cual sobre la fecha (hoy, mañana, lunes, etc.)
  - horaTexto: texto tal cual sobre la hora (a las 3, 15:00, etc.)
  - prioridad: alta|media|baja|null
- NO calcules fechas reales, NO inventes años, NO conviertas nada.
- Devuelve SOLO un JSON válido.

Formato obligatorio:

{
  "tareas": [
    {
      "accion": "texto claro",
      "fechaTexto": "texto o null",
      "horaTexto": "texto o null",
      "prioridad": "alta|media|baja|null"
    }
  ]
}

Reglas:
- Si no hay tarea, devuelve {"tareas": []}
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

      const fecha = t.fechaTexto ? parseFechaDesdeTexto(t.fechaTexto) : null;
      let hora = t.horaTexto ? parseHoraDesdeTexto(t.horaTexto) : parseHoraDesdeTexto(clean);

      // Si hay indicios de hora pero es ambigua → preguntar
      const hayNumeroHora = /\b\d{1,2}(\:\d{2})?\b/.test(normalizarTextoFechaHora(clean));
      if (hayNumeroHora && !hora) {
        pendingTime[userId] = {
          accion: t.accion,
          fecha: fecha || getTodayDate(),
          prioridad: t.prioridad || null
        };
        // La respuesta al usuario la gestiona askOpenRouter
        return;
      }

      // Evitar duplicados
      const tasks = await loadTasks(userId);
      const existe = tasks.some(task =>
        task.accion === t.accion &&
        task.fecha === fecha &&
        task.hora === hora
      );
      if (existe) continue;

      saveDeepFact(
        userId,
        "tareas",
        "tarea",
        JSON.stringify({
          accion: t.accion,
          fecha: fecha,
          hora: hora,
          prioridad: t.prioridad || null,
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
    "deberia",
    "quiero hacer",
    "tarea:",
    "tareas:"
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
// OPENROUTER — RESPUESTA INTELIGENTE
// =========================

async function askOpenRouter(userId, userMessage) {
  const deepProfile = await loadDeepProfile(userId);

  // 0) Si hay una hora pendiente, la respuesta del usuario es para eso
  if (pendingTime[userId]) {
    const hora = parseHoraDesdeTexto(userMessage);
    if (!hora) {
      return "¿Te refieres a las 3 de la mañana o a las 3 de la tarde?";
    }

    const { accion, fecha, prioridad } = pendingTime[userId];
    delete pendingTime[userId];

    const tasks = await loadTasks(userId);
    const existe = tasks.some(t =>
      t.accion === accion &&
      t.fecha === fecha &&
      t.hora === hora
    );
    if (!existe) {
      saveDeepFact(
        userId,
        "tareas",
        "tarea",
        JSON.stringify({
          accion,
          fecha,
          hora,
          prioridad: prioridad || null,
          estado: "pendiente"
        })
      );
    }

    return `Perfecto, lo apunto: ${accion} el ${fecha} a las ${hora}.`;
  }

  // 1) Preguntas de memoria directa
  const tipo = detectarTipoPregunta(userMessage);
  if (tipo) {
    const directa = responderDesdeMemoria(tipo, deepProfile);
    if (directa) return directa;
  }

  // 2) Comandos de organización
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

  // 3) Detectar si el mensaje es una tarea
  if (detectarTarea(userMessage)) {
    // Si hay hora ambigua, la lógica de preguntar ya se disparó en analizarYGuardarHechos
    return "Perfecto, lo guardo como tarea.";
  }

  const messages = [
    {
      role: "system",
      content: `
Eres Ibrabot, un asistente profesional que piensa con calma, razona y organiza la vida del usuario.

OBJETIVO:
- Ayudar al usuario a pensar mejor, decidir mejor y organizar mejor su vida y sus proyectos.
- Actuar como un "jefe de operaciones" personal: priorizas, estructuras, propones planes y siguientes pasos.

IDENTIDAD:
- Siempre hablas DESDE la perspectiva del usuario.
- Usa "tú", "tu madre", "tu ciudad", "tu proyecto".
- Nunca digas "mi madre", "mi ciudad", "mi proyecto".

ESTILO:
- Claro, directo y concreto.
- Sin frases vacías ni relleno.
- Siempre orientado a la acción: qué hacer ahora, hoy, esta semana.
- Puedes ajustar tu forma de hablar: si el usuario te pide "sé más claro", "sé más corto", "explícalo mejor", lo aplicas en las siguientes respuestas.

MODOS INTERNOS (no los nombres):
- PLAN: devuelves pasos claros y ordenados.
- ANÁLISIS: explicas el problema en 3-5 puntos clave.
- PRIORIDADES: ordenas qué hacer primero, segundo, tercero.
- IDEAS: das ideas concretas, accionables.
- RESUMEN: devuelves lo esencial.
- DECISIÓN: comparas opciones y recomiendas una, explicando por qué.

IMPORTANTE:
- Piensa con lógica, como si tuvieras una vida y experiencia: no respondas cosas obvias o vacías.
- Si el usuario está confuso, primero ordena su situación y luego propones un plan.
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

console.log("⚡ Ibrabot listo: memoria profunda + tareas con fechas reales + razonamiento y organización.");
