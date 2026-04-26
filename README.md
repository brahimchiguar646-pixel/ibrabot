# 🤖 Ibrabot PRO

A fully autonomous Telegram assistant — your personal chief of operations.

Ibrabot manages your memory, tasks, reminders, web research, code generation, and external integrations — all controlled by you through a confirmation-first agent model.

---

## Features

| Module | What it does |
|--------|-------------|
| 🧠 Deep Memory | Stores facts about you (name, city, projects, preferences) in SQLite |
| 📋 Tasks | Extracts, stores, and reminds you of tasks with dates and times |
| ⏰ Scheduler | Sends Telegram reminders at the exact task time |
| 🎙 Voice | Transcribes voice messages (Whisper via OpenRouter) |
| 🔍 Web | Reads and summarises any public web page (read-only, rate-limited) |
| ⚙️ Generator | Scaffolds Express, React, or full-stack apps for you |
| 🎨 Canva | Creates designs via Canva API (your token) |
| 📱 WhatsApp | Sends messages via WhatsApp Business API (your credentials) |
| 🛡 Agent | Every external action requires your explicit confirmation |
| 🖥 Admin | Web panel at `localhost:3000` to view logs and approve actions |

---

## Quick Start

```bash
# 1. Clone and install
npm install

# 2. Set your secrets in Replit Secrets (or .env for local)
TELEGRAM_TOKEN=...
OPENROUTER_API_KEY=...
ADMIN_TOKEN=...          # optional, for admin panel

# 3. Start
npm start
```

---

## Bot Commands

| Command | Description |
|---------|-------------|
| `!ayuda` | Show all commands |
| `!buscar <query>` | Web search (asks for confirmation) |
| `!leer <url>` | Read and summarise a web page |
| `!generar express <name>` | Scaffold a Node/Express API |
| `!generar react <name>` | Scaffold a React + Vite app |
| `!generar fullstack <name>` | Scaffold API + UI |
| `!backup` | Backup your memory (asks for confirmation) |
| `!confirm <id>` | Approve a pending action |
| `!cancel <id>` | Reject a pending action |
| `!pendientes` | List your pending confirmations |

**Natural language:**
- `"Tengo que llamar al médico mañana a las 3 de la tarde"` → saves task
- `"¿Qué tengo hoy?"` → lists today's tasks
- `"¿Cómo me llamo?"` → retrieves from memory
- Any message → AI response as your personal chief of operations

---

## Admin Panel

The admin panel runs at `http://localhost:3000`.

Protect it with the `ADMIN_TOKEN` secret. Use the `X-Admin-Token` header or `?token=` query param.

Features:
- View and approve/reject pending agent actions
- Browse action history
- Read audit logs
- Trigger memory backup

---

## Project Structure

```
bot.js               Entry point
src/
  utils/logger.js    Logging + audit trail
  core/              db, shortMemory, spamControl, scheduler
  modules/           memory, ai, tasks, voice, web, generator, agent
  modules/integrations/  canva, whatsapp
  web/admin.js       Admin panel
tests/               Unit tests
logs/                Audit logs (auto-created)
generated/           Scaffolded apps (auto-created)
.env.example         Environment variable template
CHANGELOG.md         Version history
CONTRIBUTING.md      Developer guide
```

---

## Security

- All secrets stored in environment variables / Replit Secrets — never hardcoded.
- Every external or destructive action requires explicit `!confirm <id>`.
- Admin panel requires `ADMIN_TOKEN`.
- Web module is strictly read-only with per-domain rate limiting.
- Canva and WhatsApp integrations only activate when you provide your own tokens.

---

## Optional Integrations

### Canva
1. Create a Canva app at [canva.com/developers](https://www.canva.com/developers)
2. Add `CANVA_API_KEY` to your secrets
3. Use `!confirm` flow to create designs

### WhatsApp Business
1. Set up [Meta WhatsApp Business API](https://developers.facebook.com/docs/whatsapp)
2. Add `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_VERIFY_TOKEN`
3. Use `!confirm` flow to send messages

---

## License

MIT
