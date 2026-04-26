const axios = require('axios');
const logger = require('../../utils/logger');

const CANVA_API_BASE = 'https://api.canva.com/rest/v1';

function getHeaders() {
  const token = process.env.CANVA_API_KEY;
  if (!token) throw new Error('CANVA_API_KEY not set. Add it to your secrets.');
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json'
  };
}

async function listDesigns() {
  const response = await axios.get(`${CANVA_API_BASE}/designs`, {
    headers: getHeaders(),
    timeout: 10000
  });
  return response.data;
}

async function getDesign(designId) {
  const response = await axios.get(`${CANVA_API_BASE}/designs/${designId}`, {
    headers: getHeaders(),
    timeout: 10000
  });
  return response.data;
}

async function createDesign(params = {}) {
  const { designType = 'presentation', title = 'Ibrabot Design' } = params;

  const response = await axios.post(
    `${CANVA_API_BASE}/designs`,
    { design_type: { type: designType }, title },
    { headers: getHeaders(), timeout: 10000 }
  );

  logger.success('Canva design created: ' + response.data.design?.id);
  return response.data;
}

async function exportDesign(designId, format = 'pdf') {
  const response = await axios.post(
    `${CANVA_API_BASE}/exports`,
    { design_id: designId, format: { type: format } },
    { headers: getHeaders(), timeout: 30000 }
  );
  return response.data;
}

function isConfigured() {
  return !!process.env.CANVA_API_KEY;
}

module.exports = { listDesigns, getDesign, createDesign, exportDesign, isConfigured };
