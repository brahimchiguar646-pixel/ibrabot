const fs = require('fs');
const path = require('path');
const axios = require('axios');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
const logger = require('../utils/logger');

ffmpeg.setFfmpegPath(ffmpegPath);

const TMP_DIR = path.join(__dirname, '../../logs/tmp_audio');

function ensureTmpDir() {
  if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });
}

async function downloadVoice(bot, fileId) {
  ensureTmpDir();

  const fileInfo = await bot.getFile(fileId);
  const fileUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_TOKEN}/${fileInfo.file_path}`;
  const dest = path.join(TMP_DIR, `${fileId}.ogg`);

  const response = await axios({ url: fileUrl, responseType: 'stream' });
  await new Promise((resolve, reject) => {
    const writer = fs.createWriteStream(dest);
    response.data.pipe(writer);
    writer.on('finish', resolve);
    writer.on('error', reject);
  });

  return dest;
}

function convertToMp3(inputPath) {
  const outputPath = inputPath.replace('.ogg', '.mp3');
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .toFormat('mp3')
      .save(outputPath)
      .on('end', () => resolve(outputPath))
      .on('error', reject);
  });
}

async function transcribeWithOpenRouter(audioPath) {
  try {
    const apiKey = process.env.OPENROUTER_API_KEY;

    const audioBuffer = fs.readFileSync(audioPath);
    const base64Audio = audioBuffer.toString('base64');

    const response = await axios.post(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        model: 'openai/whisper-large-v3',
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'input_audio',
                input_audio: { data: base64Audio, format: 'mp3' }
              }
            ]
          }
        ]
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        timeout: 30000
      }
    );

    return response.data.choices[0].message.content.trim();
  } catch (err) {
    logger.warn('Whisper via OpenRouter failed, using fallback: ' + err.message);
    return null;
  }
}

function cleanup(...files) {
  for (const f of files) {
    try { if (f && fs.existsSync(f)) fs.unlinkSync(f); } catch {}
  }
}

async function processVoiceMessage(bot, fileId) {
  let oggPath, mp3Path;
  try {
    logger.info('Processing voice message: ' + fileId);

    oggPath = await downloadVoice(bot, fileId);
    mp3Path = await convertToMp3(oggPath);

    const transcript = await transcribeWithOpenRouter(mp3Path);

    cleanup(oggPath, mp3Path);

    if (transcript) {
      logger.success('Voice transcribed: ' + transcript.slice(0, 60));
      return transcript;
    }

    return null;
  } catch (err) {
    logger.error('processVoiceMessage error: ' + err.message);
    cleanup(oggPath, mp3Path);
    return null;
  }
}

module.exports = { processVoiceMessage };
