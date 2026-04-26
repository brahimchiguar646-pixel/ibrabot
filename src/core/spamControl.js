const SPAM_INTERVAL = 3000;
const SPAM_LIMIT = 3;

const registry = {};

function isSpam(userId) {
  const now = Date.now();

  if (!registry[userId]) {
    registry[userId] = { lastMessageTime: now, count: 1 };
    return false;
  }

  const diff = now - registry[userId].lastMessageTime;

  if (diff < SPAM_INTERVAL) {
    registry[userId].count++;
  } else {
    registry[userId].count = 1;
  }

  registry[userId].lastMessageTime = now;
  return registry[userId].count > SPAM_LIMIT;
}

function reset(userId) {
  delete registry[userId];
}

module.exports = { isSpam, reset };
