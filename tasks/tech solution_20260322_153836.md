# TaskBus

TaskBus is an MVP task orchestration system for AI agents.

It provides:

- a Next.js web app
- a lightweight REST API
- a SQLite database via Prisma
- a minimal CLI for agent-side integration

## MVP Scope

TaskBus currently supports:

- creating a task with `name`, `fileUrl`, `executor`, `creator`
- listing tasks with filters
- claiming the oldest pending task for a given executor
- getting a single task by id
- marking a running task as done
- viewing tasks in a simple web UI

TaskBus does not store markdown content. It only stores the referenced `fileUrl`.

## Tech Stack

- Next.js 15
- React 19
- Prisma
- SQLite
- Node.js CLI

## Project Structure

```text
app/                  Next.js app and API routes
cli/                  taskbus CLI
lib/                  schemas, db client, task service
prisma/               Prisma schema, migrations, local SQLite db
SPEC/                 product and design docs
```

## Environment

Create `.env` from `.env.example`.

Example:

```env
DATABASE_URL="file:./dev.db"
TASKBUS_BASE_URL="http://localhost:3000"
TASKBUS_API_KEY=""
```

## Install

```bash
npm install
```

## Global Command

For local global usage:

```bash
npm link
```

You can also install it globally from the project root:

```bash
npm install -g .
```

After linking, you can run:

```bash
taskbus --help
taskbus --version
taskbus claim --executor agent-b
```

## Initialize Database

```bash
npx prisma migrate dev --name init
```

This creates the local SQLite database under `prisma/dev.db`.

## Run

Start the web app:

```bash
npm run dev
```

Open:

```text
http://localhost:3000/tasks
```

## Build

```bash
npm run build
```

## Build Standalone CLI

Generate a standalone executable command that does not rely on a preinstalled Node runtime:

```bash
npm run build:cli
```

Default outputs:

```text
dist/taskbus-win-x64.exe
dist/taskbus-linux-x64
dist/taskbus-macos-x64
```

After building, you can run them directly:

```bash
dist\\taskbus-win-x64.exe --help
./dist/taskbus-linux-x64 --help
./dist/taskbus-macos-x64 --help
```

Build a single target:

```bash
node ./scripts/build-cli.mjs --target node18-win-x64 --output dist/taskbus.exe
```

Build multiple selected targets:

```bash
node ./scripts/build-cli.mjs --target node18-win-x64,node18-linux-x64
```

## REST API

### Create Task

`POST /api/tasks`

```json
{
  "name": "summarize requirement",
  "fileUrl": "nova://files/1001",
  "executor": "agent-b",
  "creator": "agent-a"
}
```

### List Tasks

`GET /api/tasks`

Query params supported:

- `executor`
- `creator`
- `status`
- `page`
- `pageSize`

### Get Task

`GET /api/tasks/:id`

### Claim Task

`POST /api/tasks/claim`

```json
{
  "executor": "agent-b"
}
```

If a task is found, TaskBus updates it from `pending` to `running` and returns the task.

If no task is available, the API returns `204 No Content`.

### Mark Done

`POST /api/tasks/:id/done`

Only `running` tasks can be marked as done.

## CLI

The CLI entry is:

```bash
node ./cli/taskbus.mjs
```

If you already ran `npm link`, you can call `taskbus` directly.

Commands:

```bash
node ./cli/taskbus.mjs create task.json
node ./cli/taskbus.mjs list --status pending --executor agent-b
node ./cli/taskbus.mjs get 1
node ./cli/taskbus.mjs claim --executor agent-b
node ./cli/taskbus.mjs done 1
node ./cli/taskbus.mjs help
node ./cli/taskbus.mjs help claim
```

Example `task.json`:

```json
{
  "name": "summarize requirement",
  "fileUrl": "nova://files/1001",
  "executor": "agent-b",
  "creator": "agent-a"
}
```

## Task Lifecycle

Supported task states:

- `pending`
- `running`
- `done`

State transitions:

- `create` -> `pending`
- `claim` -> `running`
- `done` -> `done`

## Web UI

Current pages:

- `/tasks`
- `/tasks/[id]`

The UI is read-only and intended for human observation of task status.

## Notes

- This is an MVP.
- No auth is enforced yet.
- No retry or timeout recovery exists yet.
- If an agent crashes after claiming a task, manual intervention is required.

## Spec

The current MVP design document is here:

- [SPEC/AI2AI/solution.md](SPEC/AI2AI/solution.md)
