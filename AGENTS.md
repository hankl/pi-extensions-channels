# Repository Guidelines

## Project Structure & Module Organization
This repository hosts Pi extension channels. The main extension lives in `.pi/extensions/wecom-bot/`, with runtime logic in `index.ts`, dependency metadata in `package.json`, environment examples in `.env.example`, and extension-specific notes in `README.md` and `ADR-config-management.md`. Repository-level docs live in `README.md` and `SOUL.md`. Utility scripts are in `scripts/`, task notes in `tasks/`, and session memory in `memory/`.

## Build, Test, and Development Commands
There is no root build pipeline today. Work from the extension directory when updating the WeCom channel.

```bash
cd .pi/extensions/wecom-bot
npm install
```

Installs extension dependencies.

```bash
/reload
```

Run this inside Pi after editing `index.ts` to reload the extension.

```bash
/wecom status
/wecom connect
/wecom disconnect
```

Use these Pi commands to verify connection behavior during local development.

## Coding Style & Naming Conventions
Use TypeScript with 2-space indentation, semicolons, and single quotes, matching `index.ts`. Prefer descriptive camelCase for variables and functions, PascalCase for interfaces and types, and kebab-case for extension folder names. Keep extension entrypoints in `index.ts`. Store secrets only in local `.env` files; commit `.env.example`, not real credentials.

## Testing Guidelines
Automated tests are not set up yet, so contributors should verify behavior manually in Pi. At minimum, reload the extension, run `/wecom status`, exercise connect/disconnect flows, and confirm inbound messages still round-trip to Pi correctly. If you add tests later, place them beside the extension or under a dedicated `tests/` folder and name them after the feature under test.

## Commit & Pull Request Guidelines
Recent history mixes short imperative messages (`download task file`, `added soul and crontab`) with scoped Conventional Commit style (`docs(wecom-bot): ...`). Prefer concise, imperative subjects and add a scope when touching one extension, for example `feat(wecom-bot): handle reconnect backoff`. Pull requests should include a brief summary, affected paths, manual verification steps, linked issues when applicable, and screenshots or logs for user-visible Pi command changes.

## Security & Configuration Tips
Copy `.pi/extensions/wecom-bot/.env.example` to a local `.env` and set `WECOM_BOT_ID` and `WECOM_BOT_SECRET`. Do not commit bot credentials, chat data, or local memory files unless the change explicitly requires sanitized examples.
