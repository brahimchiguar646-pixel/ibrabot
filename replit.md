# Ibrabot PRO

A fully autonomous Telegram assistant — your personal chief of operations.  
Manages memory, tasks, reminders, voice transcription, web research, code generation, and external integrations — all with a confirmation-first agent model.

## Architecture

Modular `src/` layout. `bot.js` is a thin orchestrator that delegates to modules.

```
bot.js                      Entry point + Telegram handlers
src/
  utils/logger.js           Structured logging + audit trail (logs/audit.log)
  core/
    db.js                   Promise-based SQLite wrapper (3 tables)
    shortMemory.js          Short-term conversation history (JSON file, 20 msgs)
    spamControl.js          Per-user rate limiting
    scheduler.js            node-cron task reminder (fires every minute)
  modules/
    memory.js               Deep memory CRUD (saveFact, loadProfile, loadTasks…)
    ai.js                   OpenRouter calls (normalizeText, extractTasks, smartReply…)
    tasks.js                Task detection, date/time parsing, organisation commands
    voice.js                Voice download, OGG→MP3, Whisper transcription
    web.js                  Read-only web fetch + Cheerio parsing, DDG search
    generator.js            App scaffolding (Express, React/Vite, fullstack)
    agent.js                Autonomous agent: requestConfirmation, resolveAction
    integrations/
      canva.js              Canva REST API adapter (token-based)
      whatsapp.js           WhatsApp Business API adapter (token-based)
  web/
    admin.js                Express admin panel (port 3000)
tests/
  memory.test.js            SQLite CRUD tests (4 assertions)
  tasks.test.js             Date/time/task detection tests (6 assertions)
logs/                       Audit log + audio tmp (auto-created, git-ignored)
generated/                  Scaffolded apps output (auto-created)
```

## Tech Stack

- **Runtime:** Node.js 20
- **Bot:** node-telegram-bot-api
- **AI:** OpenRouter (gpt-4o-mini + whisper-large-v3)
- **Database:** SQLite3 (deep_memory, pending_actions, agent_log tables)
- **Short-term memory:** memory.json (20 msgs per user)
- **Voice:** fluent-ffmpeg + @ffmpeg-installer/ffmpeg
- **Web:** axios + cheerio (read-only)
- **Scheduler:** node-cron
- **Admin:** Express (port 3000)
- **HTTP:** axios
- **Config:** dotenv

## Required Secrets

| Key | Description |
|-----|-------------|
| `TELEGRAM_TOKEN` | Telegram bot token from @BotFather |
| `OPENROUTER_API_KEY` | OpenRouter API key |

## Optional Secrets

| Key | Description |
|-----|-------------|
| `ADMIN_TOKEN` | Admin panel auth token (default: ibrabot-admin-token) |
| `CANVA_API_KEY` | Canva API key for design creation |
| `WHATSAPP_TOKEN` | Meta WhatsApp Business token |
| `WHATSAPP_PHONE_NUMBER_ID` | WhatsApp phone number ID |
| `WHATSAPP_VERIFY_TOKEN` | WhatsApp webhook verify token |

## Scripts

```bash
npm start           # start the bot
npm test            # run all tests
npm run test:memory
npm run test:tasks
```

## Bot Commands

| Command | Description |
|---------|-------------|
| `!ayuda` | Show all commands |
| `!buscar <query>` | Web search (asks for confirmation) |
| `!leer <url>` | Read and summarise a web page |
| `!generar express <name>` | Scaffold Node/Express API |
| `!generar react <name>` | Scaffold React + Vite app |
| `!generar fullstack <name>` | Scaffold API + UI |
| `!backup` | Backup memory (asks for confirmation) |
| `!confirm <id>` | Approve a pending agent action |
| `!cancel <id>` | Reject a pending agent action |
| `!pendientes` | List pending confirmations |

## Admin Panel

Runs at `http://localhost:3000` (console-only in Replit; accessible via SSH tunnel or deployment).  
Requires `X-Admin-Token` header or `?token=` query param matching `ADMIN_TOKEN`.
