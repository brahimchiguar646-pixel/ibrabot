const axios = require('axios');
const logger = require('../../utils/logger');

const WA_API_BASE = 'https://graph.facebook.com/v19.0';

function getHeaders() {
  const token = process.env.WHATSAPP_TOKEN;
  if (!token) throw new Error('WHATSAPP_TOKEN not set. Add it to your secrets.');
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json'
  };
}

function getPhoneNumberId() {
  const id = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!id) throw new Error('WHATSAPP_PHONE_NUMBER_ID not set. Add it to your secrets.');
  return id;
}

async function sendTextMessage(to, text) {
  const phoneId = getPhoneNumberId();

  const response = await axios.post(
    `${WA_API_BASE}/${phoneId}/messages`,
    {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'text',
      text: { preview_url: false, body: text }
    },
    { headers: getHeaders(), timeout: 10000 }
  );

  logger.action('system', 'whatsapp_sent', { to, preview: text.slice(0, 50) });
  return response.data;
}

async function sendTemplate(to, templateName, languageCode = 'es', components = []) {
  const phoneId = getPhoneNumberId();

  const response = await axios.post(
    `${WA_API_BASE}/${phoneId}/messages`,
    {
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: {
        name: templateName,
        language: { code: languageCode },
        components
      }
    },
    { headers: getHeaders(), timeout: 10000 }
  );

  return response.data;
}

function verifyWebhook(req) {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  const expected = process.env.WHATSAPP_VERIFY_TOKEN;

  if (mode === 'subscribe' && token === expected) return challenge;
  return null;
}

function isConfigured() {
  return !!(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID);
}

module.exports = {
  sendTextMessage,
  sendTemplate,
  verifyWebhook,
  isConfigured
};
