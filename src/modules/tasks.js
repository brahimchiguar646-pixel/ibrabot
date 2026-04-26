const memoryModule = require('./memory');
const logger = require('../utils/logger');

function normalizarTexto(texto) {
  return (texto || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function getTodayDate() {
  return new Date().toISOString().split('T')[0];
}

function getTomorrowDate() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().split('T')[0];
}

function parseFecha(texto) {
  const t = normalizarTexto(texto);

  if (t.includes('hoy')) return getTodayDate();
  if (t.includes('manana') || t.includes('mañana')) {
    const d = new Date(); d.setDate(d.getDate() + 1);
    return d.toISOString().split('T')[0];
  }
  if (t.includes('pasado manana') || t.includes('pasado mañana')) {
    const d = new Date(); d.setDate(d.getDate() + 2);
    return d.toISOString().split('T')[0];
  }

  const dias = { lunes: 1, martes: 2, miercoles: 3, jueves: 4, viernes: 5, sabado: 6, domingo: 0 };
  for (const nombre in dias) {
    if (t.includes(nombre)) {
      const target = dias[nombre];
      const d = new Date();
      const hoy = d.getDay();
      let diff = target - hoy;
      if (diff <= 0) diff += 7;
      d.setDate(d.getDate() + diff);
      return d.toISOString().split('T')[0];
    }
  }

  return null;
}

function parseHora(texto) {
  const t = normalizarTexto(texto);
  const regex = /(?:a las |alas |a la |a )?(\d{1,2})(?:[:h](\d{2}))?/;
  const match = t.match(regex);
  if (!match) return null;

  let h = parseInt(match[1], 10);
  const m = match[2] ? parseInt(match[2], 10) : 0;

  const manana = t.includes('de la manana') || t.includes('por la manana') || t.includes(' am') || t.endsWith('am');
  const tarde = t.includes('tarde') || t.includes('noche') || t.includes(' pm') || t.endsWith('pm');

  if (manana && h === 12) h = 0;
  if (tarde && h < 12) h += 12;
  if (!manana && !tarde) return null;
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;

  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
}

function extraerNumeroHora(texto) {
  const t = normalizarTexto(texto);
  const regex = /(\d{1,2})(?:[:h](\d{2}))?/;
  const match = t.match(regex);
  if (!match) return null;
  const h = parseInt(match[1], 10);
  const m = match[2] ? parseInt(match[2], 10) : 0;
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return { h, m };
}

function filterByDate(tasks, date) {
  return tasks.filter(t => t.fecha === date);
}

function sortByHour(tasks) {
  return [...tasks].sort((a, b) => {
    if (a.hora && b.hora) return a.hora.localeCompare(b.hora);
    return 0;
  });
}

function detectarTarea(texto) {
  const t = normalizarTexto(texto);
  return ['tengo que', 'debo', 'deberia', 'quiero hacer', 'tarea:', 'tareas:'].some(p => t.includes(p));
}

function detectarComandoOrganizacion(texto) {
  const t = normalizarTexto(texto);
  if (t.includes('que tengo hoy')) return 'hoy';
  if (t.includes('que tengo manana')) return 'manana';
  if (t.includes('organizame el dia') || t.includes('organicame el dia')) return 'organizar';
  if (t.includes('que hago primero')) return 'primero';
  if (t.includes('mis tareas') || t.includes('tareas pendientes')) return 'todas';
  return null;
}

async function handleOrganizationCommand(userId, comando) {
  const tasks = await memoryModule.loadTasks(userId);

  if (comando === 'hoy') {
    const lista = sortByHour(filterByDate(tasks, getTodayDate()));
    if (!lista.length) return 'Hoy no tienes tareas registradas.';
    return 'Tus tareas de hoy:\n' + lista.map(t => `• ${t.accion}${t.hora ? ' a las ' + t.hora : ''}`).join('\n');
  }

  if (comando === 'manana') {
    const lista = sortByHour(filterByDate(tasks, getTomorrowDate()));
    if (!lista.length) return 'Mañana no tienes tareas registradas.';
    return 'Tus tareas de mañana:\n' + lista.map(t => `• ${t.accion}${t.hora ? ' a las ' + t.hora : ''}`).join('\n');
  }

  if (comando === 'organizar') {
    const lista = sortByHour(filterByDate(tasks, getTodayDate()));
    if (!lista.length) return 'Hoy no tienes tareas para organizar.';
    return 'Plan para hoy:\n' + lista.map((t, i) => `${i + 1}. ${t.accion}${t.hora ? ' a las ' + t.hora : ''}`).join('\n');
  }

  if (comando === 'primero') {
    const lista = sortByHour(filterByDate(tasks, getTodayDate()));
    if (!lista.length) return 'Hoy no tienes tareas.';
    const primera = lista[0];
    return `Lo primero que debes hacer hoy es: ${primera.accion}${primera.hora ? ' a las ' + primera.hora : ''}.`;
  }

  if (comando === 'todas') {
    if (!tasks.length) return 'No tienes tareas registradas.';
    return 'Tus tareas pendientes:\n' + tasks.map(t =>
      `• ${t.accion}${t.fecha ? ' (' + t.fecha + ')' : ''}${t.hora ? ' a las ' + t.hora : ''}`
    ).join('\n');
  }

  return null;
}

async function saveExtractedTasks(userId, rawTasks, originalText) {
  for (const t of rawTasks) {
    if (!t.accion) continue;

    const fecha = t.fechaTexto ? parseFecha(t.fechaTexto) : null;
    let hora = t.horaTexto ? parseHora(t.horaTexto) : null;
    if (!hora) hora = parseHora(originalText);

    const base = extraerNumeroHora(originalText);
    if (base && !hora) {
      return { needsTimeConfirmation: true, accion: t.accion, fecha: fecha || getTodayDate(), prioridad: t.prioridad, baseHora: base };
    }

    const tasks = await memoryModule.loadTasks(userId);
    const duplicate = tasks.find(tk => tk.accion === t.accion && tk.fecha === fecha && tk.hora === hora);
    if (duplicate) continue;

    await memoryModule.saveFact(userId, 'tareas', 'tarea', JSON.stringify({
      accion: t.accion, fecha, hora, prioridad: t.prioridad || null, estado: 'pendiente'
    }));
    logger.action(userId, 'task_saved', { accion: t.accion, fecha, hora });
  }

  return null;
}

module.exports = {
  parseFecha, parseHora, extraerNumeroHora, normalizarTexto,
  detectarTarea, detectarComandoOrganizacion,
  handleOrganizationCommand, saveExtractedTasks,
  getTodayDate, getTomorrowDate, filterByDate, sortByHour
};
