const axios = require('axios');
const logger = require('../utils/logger');

const BASE_URL = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_MODEL = 'openai/gpt-4o-mini';

function getHeaders() {
  return {
    Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
    'Content-Type': 'application/json'
  };
}

async function chat(messages, model = DEFAULT_MODEL, timeoutMs = 15000) {
  const response = await axios.post(
    BASE_URL,
    { model, messages },
    { headers: getHeaders(), timeout: timeoutMs }
  );
  return response.data.choices[0].message.content.trim();
}

async function normalizeText(text) {
  try {
    const trimmed = (text || '').trim();
    if (!trimmed) return '';

    return await chat([
      {
        role: 'system',
        content: 'Eres un módulo de normalización de texto. Corriges errores y devuelves el texto claro. No expliques nada.'
      },
      { role: 'user', content: trimmed }
    ], DEFAULT_MODEL, 8000);
  } catch (err) {
    logger.warn('normalizeText error: ' + err.message);
    return text;
  }
}

async function extractTasks(text) {
  try {
    const clean = (text || '').trim();
    if (!clean) return [];

    const raw = await chat([
      {
        role: 'system',
        content: `Eres un módulo de extracción de tareas.
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
- No añadas nada fuera del JSON.`
      },
      { role: 'user', content: clean }
    ], DEFAULT_MODEL, 9000);

    const parsed = JSON.parse(raw);
    return parsed.tareas || [];
  } catch (err) {
    logger.warn('extractTasks error: ' + err.message);
    return [];
  }
}

async function smartReply(userId, userMessage, deepProfile, history) {
  const profileSummary = buildProfileSummary(deepProfile);

  const messages = [
    {
      role: 'system',
      content: `Eres Ibrabot, un asistente profesional que piensa con calma, razona y organiza la vida del usuario.

OBJETIVO:
- Ayudar al usuario a pensar mejor, decidir mejor y organizar mejor su vida y sus proyectos.
- Actuar como un "jefe de operaciones" personal: priorizas, estructuras, propones planes y siguientes pasos.

IDENTIDAD:
- Siempre hablas DESDE la perspectiva del usuario.
- Usa "tú", "tu madre", "tu ciudad", "tu proyecto".
- Nunca digas "mi madre", "mi ciudad", "mi proyecto".

ESTILO:
- Claro, directo, profesional. Sin rodeos.
- Máximo 3-4 oraciones salvo que pidan más detalle.
- Usa listas cuando sean útiles.
- Evita frases vacías como "Claro que sí" o "Por supuesto".

PERFIL DEL USUARIO (lo que sabes de él):
${profileSummary}

IMPORTANTE:
- Si el usuario te pregunta algo que sabes de su perfil, responde directo desde el perfil.
- Si no sabes algo, di "No tengo esa información todavía".
- Nunca inventes datos del usuario.`
    },
    ...history.map(h => ({ role: h.role, content: h.content })),
    { role: 'user', content: userMessage }
  ];

  return await chat(messages, DEFAULT_MODEL, 15000);
}

function buildProfileSummary(profile) {
  if (!profile || Object.keys(profile).length === 0) {
    return '(Sin datos de perfil todavía)';
  }

  const get = (cat, key) =>
    profile[cat] && profile[cat][key] && profile[cat][key][profile[cat][key].length - 1];

  const lines = [];
  const nombre = get('personas', 'nombre_usuario') || get('personas', 'nombre');
  const ciudad = get('lugares', 'ciudad') || get('lugares', 'residencia');
  const madre = get('personas', 'madre') || get('personas', 'nombre_madre');
  const comida = get('gustos', 'comida_favorita');
  const proyecto = get('proyectos', 'proyecto_actual');

  if (nombre) lines.push(`- Nombre: ${nombre}`);
  if (ciudad) lines.push(`- Ciudad: ${ciudad}`);
  if (madre) lines.push(`- Madre: ${madre}`);
  if (comida) lines.push(`- Comida favorita: ${comida}`);
  if (proyecto) lines.push(`- Proyecto actual: ${proyecto}`);

  return lines.length > 0 ? lines.join('\n') : '(Sin datos de perfil todavía)';
}

async function analyzeAndExtractFacts(text) {
  try {
    const raw = await chat([
      {
        role: 'system',
        content: `Analiza el texto del usuario y extrae hechos relevantes sobre él.
Devuelve SOLO un JSON con la estructura:
{
  "hechos": [
    { "categoria": "personas|lugares|gustos|proyectos|otros", "clave": "nombre_clave", "valor": "valor" }
  ]
}
Si no hay hechos relevantes, devuelve {"hechos": []}.
No añadas nada fuera del JSON.`
      },
      { role: 'user', content: text }
    ], DEFAULT_MODEL, 8000);

    const parsed = JSON.parse(raw);
    return parsed.hechos || [];
  } catch {
    return [];
  }
}

module.exports = { chat, normalizeText, extractTasks, smartReply, analyzeAndExtractFacts };
