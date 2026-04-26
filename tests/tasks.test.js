const assert = require('assert');

process.env.TELEGRAM_TOKEN = 'test';
process.env.OPENROUTER_API_KEY = 'test';

const {
  parseFecha,
  parseHora,
  detectarTarea,
  detectarComandoOrganizacion,
  filterByDate,
  sortByHour
} = require('../src/modules/tasks');

function testParseFecha() {
  const today = new Date().toISOString().split('T')[0];
  assert.strictEqual(parseFecha('hoy'), today, 'hoy should return today');

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().split('T')[0];
  assert.strictEqual(parseFecha('mañana'), tomorrowStr, 'mañana should return tomorrow');

  assert.strictEqual(parseFecha('texto sin fecha'), null, 'unknown text should return null');
  console.log('  ✅ testParseFecha passed');
}

function testParseHora() {
  assert.strictEqual(parseHora('a las 3 de la tarde'), '15:00', '3 de la tarde = 15:00');
  assert.strictEqual(parseHora('a las 10 de la mañana'), '10:00', '10 de la mañana = 10:00');
  assert.strictEqual(parseHora('a las 8 pm'), '20:00', '8 pm = 20:00');
  assert.strictEqual(parseHora('sin hora'), null, 'no hour should return null');
  console.log('  ✅ testParseHora passed');
}

function testDetectarTarea() {
  assert.ok(detectarTarea('tengo que llamar al médico'), 'tengo que = task');
  assert.ok(detectarTarea('debo enviar el informe'), 'debo = task');
  assert.ok(detectarTarea('Tarea: revisar correos'), 'tarea: = task');
  assert.ok(!detectarTarea('¿cómo me llamo?'), 'question is not a task');
  console.log('  ✅ testDetectarTarea passed');
}

function testDetectarComandoOrganizacion() {
  assert.strictEqual(detectarComandoOrganizacion('¿qué tengo hoy?'), 'hoy', 'hoy command');
  assert.strictEqual(detectarComandoOrganizacion('¿qué tengo mañana?'), 'manana', 'mañana command');
  assert.strictEqual(detectarComandoOrganizacion('mis tareas'), 'todas', 'todas command');
  assert.strictEqual(detectarComandoOrganizacion('hola'), null, 'no command');
  console.log('  ✅ testDetectarComandoOrganizacion passed');
}

function testFilterByDate() {
  const tasks = [
    { accion: 'A', fecha: '2025-01-10' },
    { accion: 'B', fecha: '2025-01-11' },
    { accion: 'C', fecha: '2025-01-10' }
  ];
  const filtered = filterByDate(tasks, '2025-01-10');
  assert.strictEqual(filtered.length, 2, 'Should filter to 2 tasks');
  console.log('  ✅ testFilterByDate passed');
}

function testSortByHour() {
  const tasks = [
    { accion: 'C', hora: '15:00' },
    { accion: 'A', hora: '08:00' },
    { accion: 'B', hora: '12:00' }
  ];
  const sorted = sortByHour(tasks);
  assert.strictEqual(sorted[0].hora, '08:00', 'First should be 08:00');
  assert.strictEqual(sorted[2].hora, '15:00', 'Last should be 15:00');
  console.log('  ✅ testSortByHour passed');
}

async function main() {
  console.log('\n🧪 Running task tests...\n');

  try {
    testParseFecha();
    testParseHora();
    testDetectarTarea();
    testDetectarComandoOrganizacion();
    testFilterByDate();
    testSortByHour();
    console.log('\n✅ All task tests passed.\n');
  } catch (err) {
    console.error('\n❌ Test failed:', err.message);
    process.exitCode = 1;
  }
}

main();
