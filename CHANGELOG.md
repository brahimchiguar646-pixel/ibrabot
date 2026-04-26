# Changelog

All notable changes to Ibrabot are documented here.

---

## [2.0.0] - 2025-01-26 — PRO Release

### Added
- **Modular architecture**: refactored monolithic `bot.js` into `src/` modules
- **`src/utils/logger.js`**: structured logging with audit trail to `logs/audit.log`
- **`src/core/db.js`**: promise-based SQLite wrapper; added `pending_actions` and `agent_log` tables
- **`src/core/shortMemory.js`**: clean module for short-term conversation history
- **`src/core/spamControl.js`**: rate-limiting module
- **`src/core/scheduler.js`**: cron-based task reminder system (fires each minute)
- **`src/modules/memory.js`**: full CRUD for deep memory — saveFact, updateFact, deleteFact, loadProfile, loadTasks, updateTask, deleteTask, purgeExpiredFacts, backupMemory
- **`src/modules/ai.js`**: centralised OpenRouter calls — normalizeText, extractTasks, smartReply, analyzeAndExtractFacts, buildProfileSummary
- **`src/modules/tasks.js`**: task detection, date/time parsing, organisation commands
- **`src/modules/voice.js`**: voice message download, OGG→MP3 conversion, Whisper transcription via OpenRouter
- **`src/modules/web.js`**: read-only web fetching + Cheerio-based extraction, DuckDuckGo search, rate limiting per domain
- **`src/modules/generator.js`**: code scaffolding for Express, React (Vite), and full-stack apps
- **`src/modules/integrations/canva.js`**: Canva REST API adapter (token-based)
- **`src/modules/integrations/whatsapp.js`**: WhatsApp Business API adapter (token-based)
- **`src/modules/agent.js`**: autonomous agent with confirmation flow — requestConfirmation, resolveAction, action history
- **`src/web/admin.js`**: Express admin panel on port 3000 — logs, pending actions, approve/reject UI
- **Commands**: `!buscar`, `!leer`, `!generar`, `!backup`, `!confirm`, `!cancel`, `!pendientes`, `!ayuda`
- **Tests**: `tests/memory.test.js`, `tests/tasks.test.js`
- **Docs**: `CHANGELOG.md`, `CONTRIBUTING.md`, `.env.example`, updated `README.md`

### Changed
- `bot.js` is now a thin orchestrator; all logic lives in `src/`
- `package.json` scripts updated: `start`, `test`, `test:memory`, `test:tasks`

### Security
- All external action calls require explicit user confirmation via `!confirm <id>`
- Admin panel protected by `ADMIN_TOKEN` header
- No credentials hardcoded; all secrets via environment variables

---

## [1.0.0] - 2025-01-01 — Initial Release

- Telegram bot with deep memory (SQLite) and short-term history
- Task extraction and organisation commands
- OpenRouter AI responses
- Basic spam control
- FFmpeg voice message support
