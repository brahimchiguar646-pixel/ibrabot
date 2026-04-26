# Contributing to Ibrabot

Thank you for your interest in contributing!

## Getting Started

1. Fork the repository and clone your fork.
2. Copy `.env.example` to `.env` and fill in your secrets.
3. Install dependencies: `npm install`
4. Run tests: `npm test`
5. Start the bot: `npm start`

## Project Structure

```
bot.js                    # Entry point and Telegram handler
src/
  utils/logger.js         # Structured logging + audit trail
  core/
    db.js                 # SQLite promise wrapper
    shortMemory.js        # Short-term conversation history
    spamControl.js        # Rate limiting
    scheduler.js          # Cron job reminders
  modules/
    memory.js             # Deep memory CRUD
    ai.js                 # OpenRouter AI calls
    tasks.js              # Task parsing and commands
    voice.js              # Voice/STT processing
    web.js                # Read-only web scraping
    generator.js          # App scaffolding
    agent.js              # Autonomous agent + confirmations
    integrations/
      canva.js            # Canva API adapter
      whatsapp.js         # WhatsApp Business API adapter
  web/
    admin.js              # Admin panel (Express, port 3000)
tests/
  memory.test.js
  tasks.test.js
logs/                     # Audit logs (git-ignored)
generated/                # Scaffolded apps output (git-ignored)
```

## Coding Standards

- Use `const`/`let`, never `var`.
- Always use `async/await` over raw Promise chains.
- Log errors via `logger.error()`, never `console.error()` directly.
- Never hardcode secrets; use `process.env.*` and document in `.env.example`.
- All external actions that modify state must go through the agent confirmation flow.

## Adding a New Integration

1. Create `src/modules/integrations/<name>.js`.
2. Export `isConfigured()`, and the relevant action functions.
3. Add the action to `agent.js` `executeAction()` switch.
4. Document the required env vars in `.env.example`.
5. Add a `!<command>` handler in `bot.js`.

## Running Tests

```bash
npm test          # run all tests
npm run test:memory
npm run test:tasks
```

## Commit Message Format

```
<type>(<scope>): <short description>

feat(memory): add backup rotation
fix(voice): handle OGG conversion error
chore: update dependencies
test: add integration tests for canva module
```

Types: `feat`, `fix`, `chore`, `docs`, `test`, `refactor`, `ci`

## Security

- **Never** commit `.env` or real credentials.
- All PRs touching secrets or external actions need a review.
- Keep `ADMIN_TOKEN` strong and out of version control.
