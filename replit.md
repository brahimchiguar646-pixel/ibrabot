# Ibrabot

A Telegram bot with advanced memory, task management, and AI-powered voice integration. Acts as a personal chief of operations to help users organize their lives and projects.

## Tech Stack

- **Runtime:** Node.js 20
- **Bot Framework:** node-telegram-bot-api
- **AI:** OpenRouter API (GPT-4o-mini) for natural language understanding and task extraction
- **Database:** SQLite3 (deep memory / structured facts and tasks)
- **Short-term memory:** memory.json (last 20 messages per user)
- **Voice:** fluent-ffmpeg + @ffmpeg-installer/ffmpeg for audio processing
- **HTTP:** axios
- **Config:** dotenv

## Project Structure

- `bot.js` — Main bot logic and entry point
- `memory.db` — SQLite database for persistent deep memory
- `memory.json` — Short-term conversation history cache
- `profile.json` — User profile/metadata storage
- `package.json` — Dependencies and start script

## Environment Variables (Secrets)

- `TELEGRAM_TOKEN` — Telegram bot token from @BotFather
- `OPENROUTER_API_KEY` — OpenRouter API key for AI features

## Running

```bash
npm start
```

The bot runs as a long-lived polling process (no web server). It connects to Telegram via long-polling and processes messages in real time.

## Features

- Deep memory (SQLite): stores facts about users by category/key
- Short-term memory: last 20 messages kept per user for context
- Task extraction: AI identifies tasks, dates, times, and priorities from messages
- Memory queries: detects questions about user's stored personal info
- Voice message support: processes audio via FFmpeg
- Spam/rate-limit control
