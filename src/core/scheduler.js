const cron = require('node-cron');
const logger = require('../utils/logger');

let botInstance = null;
let tasksLoader = null;

const jobs = new Map();

function init(bot, loadTasksFn) {
  botInstance = bot;
  tasksLoader = loadTasksFn;
  startReminderJob();
  logger.info('Scheduler iniciado.');
}

function startReminderJob() {
  const job = cron.schedule('* * * * *', async () => {
    if (!botInstance || !tasksLoader) return;

    try {
      const now = new Date();
      const todayDate = now.toISOString().split('T')[0];
      const currentHour = now.getHours().toString().padStart(2, '0');
      const currentMin = now.getMinutes().toString().padStart(2, '0');
      const currentTime = `${currentHour}:${currentMin}`;

      const { all } = require('./db');
      const userRows = await all(
        `SELECT DISTINCT userId FROM deep_memory WHERE category = 'tareas'`
      );

      for (const row of userRows) {
        const userId = row.userId;
        const tasks = await tasksLoader(userId);

        for (const task of tasks) {
          if (
            task.estado === 'pendiente' &&
            task.fecha === todayDate &&
            task.hora === currentTime
          ) {
            try {
              await botInstance.sendMessage(
                userId,
                `⏰ *Recordatorio:* ${task.accion}`,
                { parse_mode: 'Markdown' }
              );
              logger.action(userId, 'reminder_sent', { task: task.accion });
            } catch (e) {
              logger.error('Error enviando recordatorio: ' + e.message);
            }
          }
        }
      }
    } catch (err) {
      logger.error('Error en scheduler: ' + err.message);
    }
  });

  jobs.set('reminders', job);
}

function stop() {
  for (const job of jobs.values()) job.stop();
  jobs.clear();
}

module.exports = { init, stop };
