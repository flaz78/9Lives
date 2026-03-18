# 9Lives.ai

**Decentralized agent orchestration platform**

9Lives.ai lets you create, manage, and orchestrate autonomous AI agents (called **Lives**) and coordinated groups of agents (called **Crews**). They can operate across multiple communication channels (Telegram, WhatsApp, Gmail) and use a rich tool ecosystem (Google Drive, Calendar, browser automation, document generation, and more).

---

## Table of Contents

- [Architecture](#architecture)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
  - [Docker (recommended)](#docker-recommended)
  - [Linux](#linux)
  - [Windows](#windows)
  - [Raspberry Pi](#raspberry-pi)
- [Advanced Docker Configuration](#advanced-docker-configuration)
  - [Printing from the gateway container](#printing-from-the-gateway-container)
  - [Using host-local services](#using-host-local-services)
  - [Permissions and volumes](#permissions-and-volumes)
- [Configuration](#configuration)
  - [Environment variables](#environment-variables)
  - [First startup](#first-startup)
- [Core Concepts](#core-concepts)
  - [Lives (Agents)](#lives-agents)
  - [Crews (Supervisors)](#crews-supervisors)
  - [Skills](#skills)
  - [Connectors](#connectors)
  - [Jobs (Scheduling)](#jobs-scheduling)
  - [Settings (LLM Configurations)](#settings-llm-configurations)
  - [System and Per-Live Guardrails](#system-and-per-live-guardrails)
- [Control UI](#control-ui)
- [Communication Channels](#communication-channels)
  - [Telegram](#telegram)
  - [WhatsApp](#whatsapp)
  - [Gmail](#gmail)
- [Skills Overview](#skills-overview)
- [Database](#database)
- [Project Structure](#project-structure)
- [Bootstrap and Prompt System](#bootstrap-and-prompt-system)
- [Security](#security)
- [Troubleshooting](#troubleshooting)

---

## Architecture

9Lives.ai uses a TypeScript monorepo architecture with these main components:

- **Gateway** (`apps/gateway`): Node.js/Express backend that handles WebSocket and HTTP traffic, LLM orchestration, tool registry, cron scheduler, and communication channels.
- **Control UI** (`apps/control-ui`): web interface built with Lit and Vite to manage Lives, Crews, Skills, Connectors, and Jobs.
- **Shared** (`packages/shared`): shared WebSocket protocol between gateway and UI.
- **Workspace** (`workspace/`): Lives, Skills, bootstrap files, and working storage.

High-level flow:

```text
Control UI <-> Gateway <-> PostgreSQL
                     <-> Tools / Channels / External APIs
```

---

## Prerequisites

| Component | Minimum Version |
|-----------|-----------------|
| Node.js | 22.x |
| pnpm | 9.x |
| PostgreSQL | 16.x |
| Docker (optional) | 24.x |
| Docker Compose | 2.x |
| Git | 2.x |

For browser automation on bare metal, Chromium must also be installed.

---

## Installation

### Docker (recommended)

This is the simplest installation path for Linux, Windows, and Raspberry Pi.

#### 1. Clone the repository

```bash
git clone https://github.com/flaz78/9Lives.git
cd 9Lives
```

#### 2. Configure environment variables

```bash
cp .env.example .env
```

Edit `.env` and set your values:

```env
GATEWAY_PORT=3000
GATEWAY_BIND=0.0.0.0
GATEWAY_TOKEN=your_secure_token
DATABASE_URL=postgres://postgres:postgres@db:5432/ninelives
APP_MASTER_KEY=generate_a_random_secret_of_at_least_32_chars
OPENAI_API_KEY=sk-your-openai-key
TELEGRAM_ENABLED=true
GMAIL_ENABLED=true
WHATSAPP_ENABLED=true
```

#### 3. Start with Docker Compose

```bash
docker compose up -d
```

This starts two services:

| Service | Description | Port |
|---------|-------------|------|
| `db` | PostgreSQL 16 | 5432 |
| `gateway` | 9Lives Gateway + Control UI | 3000 |

#### 4. Verify

Open `http://localhost:3000` in your browser.

#### Useful Docker commands

```bash
# rebuild after code changes
docker compose build gateway && docker compose up -d gateway

# follow logs
docker compose logs -f gateway

# stop everything
docker compose down

# stop and remove database data
docker compose down -v
```

### Linux

Tested on Ubuntu 22.04/24.04, Debian 12, and derivatives.

Typical setup:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
npm install -g pnpm
sudo apt install -y postgresql-16 git
sudo apt install -y chromium-browser
```

Then:

```bash
sudo -u postgres psql -c "CREATE DATABASE ninelives;"
sudo -u postgres psql -c "ALTER USER postgres PASSWORD 'postgres';"
git clone https://github.com/flaz78/9Lives.git
cd 9Lives
pnpm install
cp .env.example .env
pnpm build
pnpm dev
```

### Windows

Recommended options:

- Docker Desktop with WSL2 for the simplest setup.
- Native Node.js + PostgreSQL installation for local development.

Typical native setup:

```powershell
git clone https://github.com/flaz78/9Lives.git
cd 9Lives
pnpm install
Copy-Item .env.example .env
pnpm build
pnpm dev
```

### Raspberry Pi

The Docker setup is the recommended path on Raspberry Pi as well. The provided Docker configuration is built with ARM support in mind.

---

## Advanced Docker Configuration

### Printing from the gateway container

The `print.default` tool uses the operating system print backend inside the container.

- The `gateway` image includes `cups-client` (`lp`, `lpstat`).
- If the printer test reports missing backend support, rebuild the image:

```bash
docker compose build --no-cache gateway && docker compose up -d gateway
```

### Using host-local services

The default `docker-compose.yml` already includes:

- `extra_hosts: host.docker.internal:host-gateway`
- public DNS resolvers for more stable name resolution

This allows the gateway container to reach host-local services such as LM Studio, Ollama, or a local Outlook bridge.

### Permissions and volumes

Main mounted volumes:

- `./workspace:/app/workspace`
- `./data:/app/data`

Notes:

- `workspace/bootstrap/` is read at runtime by the gateway.
- After deployment, you can update `SOUL.md`, `USER.md`, and `GUARDRAIL.md` without rebuilding the container.
- In production, avoid `docker compose down -v` unless you intentionally want to remove PostgreSQL data.

---

## Configuration

### Environment variables

Common variables:

| Variable | Description |
|----------|-------------|
| `GATEWAY_PORT` | HTTP/WebSocket port |
| `GATEWAY_BIND` | Bind address |
| `GATEWAY_TOKEN` | UI authentication token |
| `DATABASE_URL` | PostgreSQL connection string |
| `APP_MASTER_KEY` | encryption key for secrets |
| `OPENAI_API_KEY` | fallback OpenAI API key |
| `TELEGRAM_ENABLED` | enable Telegram adapter |
| `GMAIL_ENABLED` | enable Gmail integration |
| `WHATSAPP_ENABLED` | enable WhatsApp adapter |
| `PLAYWRIGHT_ENABLED` | enable Playwright tools |
| `BOOTSTRAP_DIR` | optional bootstrap override |
| `SKILLS_DIR` | optional skills directory override |

### First startup

Recommended first steps:

1. Start the stack.
2. Open the Control UI.
3. Configure at least one LLM in **Settings**.
4. Create a Live.
5. Attach Skills and channels if needed.
6. Test the Live with a manual prompt.

---

## Core Concepts

### Lives (Agents)

A **Live** is a single agent with its own:

- identity and name
- model/provider configuration
- system prompt
- Skills
- channels
- optional per-agent guardrail

Lives can be triggered manually, via channels, or from Jobs and Crews.

#### `.live.md` file

Each Live is represented by a Markdown file with YAML frontmatter in `workspace/lives/`.

Typical structure:

```md
---
id: my-live
name: "My Live"
description: "Example live"
model:
  provider: openai
  name: gpt-4o-mini
routing:
  default: false
skills: ["filesystem", "search"]
policy:
  tool_allow: []
  tool_deny: []
memory:
  mode: workspace_md
  files: []
---

# Personality / SOUL
You are a pragmatic assistant.
```

### Crews (Supervisors)

A **Crew** is a coordinator that routes work across multiple Lives.

Supported orchestration modes:

1. `router`: choose the most appropriate member.
2. `broadcast`: ask all members.
3. `pipeline`: run members in order.
4. `supervisor_llm`: use a dedicated supervisor model.

### Skills

A **Skill** bundles:

- a name and description
- operating rules
- one or more callable tools

Skills are loaded from `workspace/skills/` and become available to Lives.

### Connectors

Connectors handle external integrations such as:

- Telegram
- WhatsApp
- Gmail
- Google Drive
- Webhooks
- printing

### Jobs (Scheduling)

Jobs let you run a Live or Crew on a cron schedule.

Common examples:

| Expression | Meaning |
|------------|---------|
| `0 9 * * *` | every day at 09:00 |
| `0 9 * * 1-5` | weekdays at 09:00 |
| `*/30 * * * *` | every 30 minutes |
| `0 8,13,18 * * *` | at 08:00, 13:00, and 18:00 |

### Settings (LLM Configurations)

The **Settings** section lets you configure multiple LLM providers and the global **System Guardrail**.

Each LLM configuration includes:

| Field | Description |
|-------|-------------|
| `name` | descriptive name |
| `provider` | provider type (`openai`, `google`, etc.) |
| `base_url` | optional API endpoint |
| `api_key` | provider API key, stored encrypted |

Supported setups include:

- OpenAI
- Google Gemini
- LM Studio / Ollama
- any OpenAI-compatible API

Each Live can use its own LLM configuration. Crews can also use a dedicated LLM config in `supervisor_llm` mode.

### System and Per-Live Guardrails

9Lives applies guardrails at two levels:

1. **System guardrail**: global constraints applied to all Lives.
2. **Per-Live guardrail**: extra restrictions applied to a specific agent.

#### Merge behavior

Guardrails are merged **field by field**:

- `skills.deny`, `filesystem.deny`, `api.deny`, and `confirmation_required` are unioned.
- `skills.allow`, `filesystem.allow`, and `api.allow` only narrow behavior when explicitly set on the Live.
- `limits.max_iterations` and `limits.max_tool_calls` use the stricter value.
- If a Live only defines `deny`, the rest of the system guardrail remains unchanged.

#### Where to configure the system guardrail

You can manage it in two ways:

- **UI -> Settings -> System Guardrail**: enable/disable and edit the active `GUARDRAIL.md` content directly.
- **File `workspace/bootstrap/GUARDRAIL.md`**: file-based fallback used by the runtime.

#### Hot updates

System guardrail changes are loaded by the gateway at runtime and apply to **new requests** without restarting Docker.

Important notes:

- the Settings toggle can disable the global system guardrail;
- the content uses the same Markdown + YAML frontmatter format as `GUARDRAIL.md`;
- `GUARDRAIL.md` is no longer injected twice into the prompt: it is enforced as an operational constraint, not duplicated as generic bootstrap text.

---

## Control UI

The web interface is served by the gateway on the same port and communicates with the backend over WebSocket.

Sections:

| Section | Purpose |
|---------|---------|
| Chat | talk directly to a Live |
| Lives | create, edit, delete, and trigger agents |
| Crews | create and orchestrate multi-agent groups |
| Connectors | configure integrations |
| Skills | inspect installed Skills and tools |
| Settings | manage LLM configs and the System Guardrail |

Main WebSocket methods include:

- `health.status`
- `live.list/create/update/delete`
- `live.trigger`
- `crew.list/create/update/delete`
- `crew.trigger`
- `chat.send`
- `job.list/create/update/delete`
- `creds.set/list/get/test`
- `llm_config.list/create/delete`
- `skills.list`

---

## Communication Channels

### Telegram

Telegram bots can be configured in Connectors. Incoming messages are routed to the matching Live or to the default Live.

### WhatsApp

WhatsApp support can be enabled through the dedicated adapter and uses persistent auth data in `data/`.

### Gmail

Gmail can be used for inbound/outbound workflows once credentials are configured.

---

## Skills Overview

Skills live in `workspace/skills/` and can expose tools for:

- filesystem operations
- search
- browser automation
- Google integrations
- Gmail
- Outlook Calendar bridge
- Tavily
- webhooks
- Excel, Word, PDF, and image handling
- memory and chat history
- printing

---

## Database

PostgreSQL stores the main runtime state, including:

- Lives
- Crews
- Jobs
- encrypted secrets
- chat history
- audit log
- LLM configurations

---

## Project Structure

```text
apps/
  gateway/
    src/
      channels/
      http/
      runtime/
      storage/
      ws/
    bootstrap/
  control-ui/
    src/
      views/
packages/
  shared/
workspace/
  bootstrap/
  lives/
  skills/
data/
```

Key folders:

- `apps/gateway/src/runtime/`: orchestration, guardrails, tools, scheduler
- `apps/control-ui/src/views/`: main UI views
- `workspace/lives/`: Live definitions
- `workspace/skills/`: installed Skills
- `workspace/bootstrap/`: global prompt files and guardrail fallback

---

## Bootstrap and Prompt System

The prompt system is layered by the `PromptBuilder`.

Order of composition:

1. current date/time (`Europe/Rome`)
2. bootstrap `SOUL.md`
3. bootstrap `USER.md`
4. Live personality / system prompt
5. Live operating rules
6. available Skills and tools
7. system policy reminders
8. effective guardrails
9. recent chat history
10. current user message

Important notes:

- `SOUL.md` and `USER.md` are included in the shared bootstrap context.
- `GUARDRAIL.md` is loaded separately by the runtime as a global operational constraint.
- The system guardrail can also be overridden from Settings.
- If disabled from Settings, the gateway uses a permissive global profile for new requests.

---

## Security

- **Encrypted secrets**: API keys, passwords, and tokens are encrypted before storage using `APP_MASTER_KEY`.
- **WebSocket authentication**: the UI must authenticate with `GATEWAY_TOKEN`.
- **Channel whitelists**: Telegram and WhatsApp can restrict who may interact with bots.
- **Tool policy**: each Live can define allow/deny tool policies.
- **Multi-level guardrails**: the system combines global and per-Live restrictions with a restrictive merge strategy.
- **Audit log**: important actions are recorded.
- **No plaintext credential exposure**: decrypted secrets are not exposed in normal API responses.

---

## Troubleshooting

### Gateway does not start

```text
Error: Cannot create OpenAI client: OpenAI API key not configured
```

Fix: configure an OpenAI key in Settings or set `OPENAI_API_KEY` in `.env`.

### Database connection error

```text
Error: connect ECONNREFUSED 127.0.0.1:5432
```

Fix: make sure PostgreSQL is running. With Docker, check `docker compose ps`.

### Docker build fails in gateway TypeScript

If the build fails while compiling `apps/gateway`, inspect the exact TypeScript error first. Most issues come from typed Express callbacks or new runtime changes not aligned with strict typing.

### Telegram message too long

```text
ETELEGRAM: 400 Bad Request: message is too long
```

Fix: the system automatically splits long messages, but verify that you are running an up-to-date version if the problem persists.

### `host.docker.internal` cannot be resolved

Fix: ensure `extra_hosts: host.docker.internal:host-gateway` is present in `docker-compose.yml`.

---

## Notes

`README_EN.MD` is the English companion document for `README.md`. When behavior changes, keep both files aligned.
