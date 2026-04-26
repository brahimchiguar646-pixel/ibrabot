const axios = require('axios');
const cheerio = require('cheerio');
const logger = require('../utils/logger');

const REQUEST_TIMEOUT = 10000;
const USER_AGENT = 'Ibrabot/2.0 (read-only web assistant; +https://github.com/ibrabot)';

const rateLimitMap = new Map();
const RATE_LIMIT_MS = 5000;

function checkRateLimit(domain) {
  const now = Date.now();
  const last = rateLimitMap.get(domain) || 0;

  if (now - last < RATE_LIMIT_MS) {
    const wait = Math.ceil((RATE_LIMIT_MS - (now - last)) / 1000);
    throw new Error(`Rate limit: wait ${wait}s before fetching ${domain} again.`);
  }

  rateLimitMap.set(domain, now);
}

function getDomain(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

async function fetchPage(url) {
  const domain = getDomain(url);
  checkRateLimit(domain);

  logger.info('Fetching URL: ' + url);

  const response = await axios.get(url, {
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'text/html,application/xhtml+xml,application/xml'
    },
    timeout: REQUEST_TIMEOUT,
    maxRedirects: 5,
    validateStatus: status => status < 400
  });

  return response.data;
}

function extractText(html) {
  const $ = cheerio.load(html);

  $('script, style, nav, footer, header, aside, iframe, noscript').remove();

  const title = $('title').text().trim();
  const metaDesc = $('meta[name="description"]').attr('content') || '';
  const h1 = $('h1').first().text().trim();
  const body = $('body').text().replace(/\s+/g, ' ').trim().slice(0, 3000);

  return { title, metaDesc, h1, body };
}

function extractLinks(html, baseUrl) {
  const $ = cheerio.load(html);
  const links = [];

  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    try {
      const abs = new URL(href, baseUrl).href;
      const text = $(el).text().trim();
      if (text && abs.startsWith('http')) links.push({ text, href: abs });
    } catch {}
  });

  return links.slice(0, 20);
}

async function summarizePage(url) {
  try {
    const html = await fetchPage(url);
    const content = extractText(html);
    const links = extractLinks(html, url);

    return {
      url,
      title: content.title,
      description: content.metaDesc,
      heading: content.h1,
      text: content.body,
      links
    };
  } catch (err) {
    logger.error('summarizePage error: ' + err.message);
    throw err;
  }
}

async function searchDuckDuckGo(query) {
  const encoded = encodeURIComponent(query);
  const url = `https://html.duckduckgo.com/html/?q=${encoded}`;

  const html = await fetchPage(url);
  const $ = cheerio.load(html);
  const results = [];

  $('.result__title').each((_, el) => {
    const title = $(el).text().trim();
    const href = $(el).find('a').attr('href');
    const snippet = $(el).closest('.result').find('.result__snippet').text().trim();
    if (title && href) results.push({ title, href, snippet });
  });

  return results.slice(0, 5);
}

module.exports = { fetchPage, extractText, extractLinks, summarizePage, searchDuckDuckGo };
