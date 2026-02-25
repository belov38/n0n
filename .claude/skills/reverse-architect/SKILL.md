---
description: Explore an entire codebase with parallel subagents and compile a plain-English architecture document for AI-assisted reconstruction
argument-hint: <source-dir> [output-dir] [app-url]
---

# Reverse Architect

You are a principal engineer producing a comprehensive architecture document by coordinating a swarm of specialized analysis agents.

**Arguments**: `$ARGUMENTS`
- Arg 1: path to the source code directory to analyze (required)
- Arg 2: output directory path (default: `./architecture`)
- Arg 3: running app URL for visual exploration, e.g. `http://localhost:5678` (optional)

Parse the arguments now. If no source directory is provided, stop and ask the user.

---

## Phase 1: Orient

Quick orientation using your own tools (no agents):
1. `ls` the source directory — confirm it exists and is non-empty
2. Read `README.md` or `CONTRIBUTING.md` at the root if present
3. Count packages (if monorepo)

Tell the user: "Found [X packages / Y dirs]."

---

## Phase 2: Resolve Visual Exploration

Before launching agents, determine whether to run visual exploration:

**If Arg 3 (app URL) was provided**: use it directly. Skip to Phase 3.

**If Arg 3 was NOT provided**: ask the user:

> "Visual exploration captures live screenshots for accurate UI reconstruction.
>
> Is the app running? If yes, what is the URL? (e.g. `http://localhost:5678`)
> If not, here's how to start it quickly:
>
> **n8n** (default port 5678):
> ```
> # via npx:
> npx n8n
>
> # via Docker:
> docker run -it --rm --name n8n -p 5678:5678 docker.n8n.io/n8nio/n8n
> ```
>
> Enter the URL, or type `skip` to do source-only analysis."

Wait for the user's response before proceeding.

- If user gives a URL: store it as `APP_URL`, proceed to Phase 3
- If user types `skip` or leaves blank: set `APP_URL = null`, proceed to Phase 3

---

## Phase 3: Resolve Login Credentials

If `APP_URL` is set, ask the user:

> "Does the app require login? (yes/no)
> If yes, provide: email and password (used only by the browser agent, not stored)."

- If yes: store as `LOGIN_EMAIL` and `LOGIN_PASSWORD`
- If no / skip: set both to null

---

## Phase 4: Parallel Deep Exploration

**Create the output directory** (`<OUTPUT_DIR>` and `<OUTPUT_DIR>/details/`) before launching agents.

**Launch ALL agents simultaneously in a single message.**

### Critical instruction for ALL agent prompts

Every agent prompt MUST include:

```
The source directory to analyze is: <SOURCE_DIR>

OUTPUT INSTRUCTIONS:
Write your complete analysis to: <OUTPUT_DIR>/details/<FILENAME>
Use the Write tool to create this file.

FILE REFERENCE REQUIREMENT:
For EVERY key code location you discover, include the absolute file path and line number
in the format `file_path:line_number`. These references are critical — future AI agents
will use them to navigate the codebase during reconstruction.

Include file references for:
- Interface/type definitions
- Class declarations and key methods
- Configuration files and entry points
- Database schemas and migrations
- Route/endpoint registrations
- Store definitions
- Component files
- Test files (if relevant to understanding behavior)

At the END of your document, include a "## Key Files" section that lists the 10-20 most
important files for this area, with one-line descriptions of why each matters.
```

### Source analysis agents (always run — 11 agents):

| # | Agent | subagent_type | Output File | Focus |
|---|-------|---------------|-------------|-------|
| 1 | Entry Points | `arch-entry-points` | `01-entry-points.md` | Startup sequences, process model, CLI commands, Docker, deployment topology, env vars |
| 2 | Data Model | `arch-data-model` | `02-data-model.md` | DB schema, ORM entities, migrations, relationships, domain vocabulary, ERD |
| 3 | API Surface | `arch-api-surface` | `03-api-surface.md` | REST endpoints (all of them with request/response shapes), WebSocket events, middleware stack, error format, auth flow |
| 4 | Execution Engine | `arch-execution-engine` | `04-execution-engine.md` | Core workflow executor, state machine, data envelope, node dispatch, retry, error handling, sub-workflows |
| 5 | Node System | `arch-node-system` | `05-node-system.md` | Node interface contract, parameter types, node lifecycle, credential declaration, versioning, declarative pattern, AI sub-nodes, how to add a node |
| 6 | Canvas Frontend | `arch-frontend-canvas` | `06-frontend-canvas.md` | Component tree, data↔visual mapping, interaction model, execution visualization, coordinate system, layout algorithm |
| 7 | State Management | `arch-frontend-state` | `07-frontend-state.md` | All Pinia stores, API client layer, push connection, real-time event handlers, routing, localStorage persistence |
| 8 | Queue & Scaling | `arch-queue-scaling` | `08-queue-scaling.md` | Queue library config, producer/consumer, multi-instance topology, leader election, push relay in HA, Redis usage map, graceful shutdown, failure recovery |
| 9 | Expressions & Credentials | `arch-expression-credential` | `09-expressions-credentials.md` | Expression syntax, evaluation pipeline, sandbox security, context variables, credential encryption, OAuth flow, key management |
| 10 | Triggers & Webhooks | `arch-trigger-webhook` | `10-triggers-webhooks.md` | Trigger type matrix, webhook URL lifecycle, scheduler architecture, activation system, webhook server, test webhooks |
| 11 | Dependencies | `arch-dependencies` | `11-dependencies.md` | Full tech stack table with versions and roles, key library choices, patches/overrides, build tooling |

### Visual explorer (run only if APP_URL is set):

| Agent | subagent_type | Output | Focus |
|-------|---------------|--------|-------|
| Visual Explorer | `arch-visual-explorer` | `<OUTPUT_DIR>/ui-reference/` | Screenshots, design tokens, UX patterns |

Visual explorer prompt must include:
```
App URL: <APP_URL>
Output directory: <OUTPUT_DIR>/ui-reference
Login required: <yes/no>
Login email: <LOGIN_EMAIL or "none">
Login password: <LOGIN_PASSWORD or "none">
```

**If visual explorer fails due to permissions**, do the visual exploration yourself (navigate pages, take screenshots, extract design tokens) and write `<OUTPUT_DIR>/ui-reference/UI_REFERENCE.md`.

---

## Phase 5: Synthesize

Once ALL agents have returned, write the main architecture index file to `<OUTPUT_DIR>/ARCHITECTURE.md`.

**This is NOT a full document** — it is a concise overview (~2000-3000 words) that:
1. Summarizes each area in 1-3 paragraphs
2. Links to the detailed file for each area
3. Cross-references between areas where they interact
4. Provides the rebuild roadmap with references to which detail files to read for each step

Do NOT duplicate the detailed content from agent files. The main file is a map; the detail files are the territory.

---

## Output Structure

```
<OUTPUT_DIR>/
├── ARCHITECTURE.md              ← Main index (concise overview + links)
├── details/
│   ├── 01-entry-points.md       ← Full analysis with file:line refs
│   ├── 02-data-model.md
│   ├── 03-api-surface.md
│   ├── 04-execution-engine.md
│   ├── 05-node-system.md
│   ├── 06-frontend-canvas.md
│   ├── 07-frontend-state.md
│   ├── 08-queue-scaling.md
│   ├── 09-expressions-credentials.md
│   ├── 10-triggers-webhooks.md
│   └── 11-dependencies.md
└── ui-reference/                ← Only if visual exploration ran
    ├── UI_REFERENCE.md
    └── *.png
```

## Main ARCHITECTURE.md Structure

```markdown
# [Project Name] — Architecture Document

> Auto-generated by reverse-architect. Source: [source-dir]. Date: [date].
> Detail files: [./details/](./details/)

## 1. Executive Summary
2-3 sentences: what this system does and who uses it.

## 2. System Overview
High-level Mermaid diagram: frontend → API server → execution engine → DB/Redis.
Brief description of each major component and how they connect.

## 3. Technology Stack
Table: Layer | Technology | Version | Role
→ Full analysis: [details/11-dependencies.md](./details/11-dependencies.md)

## 4. Monorepo / Package Structure
All packages with one-line descriptions. Dependency diagram (Mermaid).
→ Full analysis: [details/01-entry-points.md](./details/01-entry-points.md)

## 5. Core Domain Model
Key entities (1-2 sentences each), simplified ERD (Mermaid).
→ Full schema: [details/02-data-model.md](./details/02-data-model.md)

## 6. Execution Engine
How a workflow runs (high-level numbered steps). State machine diagram.
→ Full analysis: [details/04-execution-engine.md](./details/04-execution-engine.md)

## 7. Node / Plugin System
Node interface summary, how nodes are loaded, how to add a new one.
→ Full contract: [details/05-node-system.md](./details/05-node-system.md)

## 8. Trigger System
Trigger type table, webhook flow summary.
→ Full analysis: [details/10-triggers-webhooks.md](./details/10-triggers-webhooks.md)

## 9. API Reference
Endpoint groups summary, push event summary, auth model.
→ Full reference: [details/03-api-surface.md](./details/03-api-surface.md)

## 10. Frontend Architecture
Canvas editor summary, store catalog table, real-time update path.
→ Canvas details: [details/06-frontend-canvas.md](./details/06-frontend-canvas.md)
→ State details: [details/07-frontend-state.md](./details/07-frontend-state.md)

## 11. Credential & Expression System
Encryption summary, expression syntax overview.
→ Full analysis: [details/09-expressions-credentials.md](./details/09-expressions-credentials.md)

## 12. Scaling & High Availability
Process topology (Mermaid), queue summary, leader election.
→ Full analysis: [details/08-queue-scaling.md](./details/08-queue-scaling.md)

## 13. Configuration Reference
Required env vars table, feature flags.
→ Full reference: [details/01-entry-points.md](./details/01-entry-points.md)

## 14. UI & UX Reference
[Include only if visual exploration ran]
Design token summary, screen inventory, key UX patterns.
→ Full reference: [ui-reference/UI_REFERENCE.md](./ui-reference/UI_REFERENCE.md)

## 15. Key Patterns & Conventions
10-15 recurring architectural patterns observed across the codebase.

## 16. Rebuild Roadmap
Ordered build sequence. For each step, reference which detail file(s) to read:

1. **Data model + DB layer** → Read: [02-data-model.md](./details/02-data-model.md)
2. **Core execution engine** → Read: [04-execution-engine.md](./details/04-execution-engine.md)
3. **Expression engine** → Read: [09-expressions-credentials.md](./details/09-expressions-credentials.md)
4. **Node system + built-in nodes** → Read: [05-node-system.md](./details/05-node-system.md)
5. **Credential system** → Read: [09-expressions-credentials.md](./details/09-expressions-credentials.md)
6. **Queue + worker infrastructure** → Read: [08-queue-scaling.md](./details/08-queue-scaling.md)
7. **REST API + WebSocket server** → Read: [03-api-surface.md](./details/03-api-surface.md), [01-entry-points.md](./details/01-entry-points.md)
8. **Trigger system + webhook server** → Read: [10-triggers-webhooks.md](./details/10-triggers-webhooks.md)
9. **Frontend canvas + state** → Read: [06-frontend-canvas.md](./details/06-frontend-canvas.md), [07-frontend-state.md](./details/07-frontend-state.md)
10. **UI polish** → Read: [ui-reference/UI_REFERENCE.md](./ui-reference/UI_REFERENCE.md)

## 17. What to Improve
Honest assessment of architectural weaknesses (max 5, one paragraph each).
```

---

## Quality Rules

- The main ARCHITECTURE.md is concise (2000-3000 words) — it's an index, not a dump
- Each detail file is thorough (1000-5000 words) with `file:line` references throughout
- Every detail file ends with a "## Key Files" section listing the 10-20 most important files
- Mermaid diagrams must be syntactically valid
- Plain English. Define jargon.
- Cross-references between detail files where systems interact (e.g., execution engine doc references the node system doc)

---

## Final Step

Tell the user:
- Path to the output directory
- How many detail files were generated
- Whether visual exploration ran (and path to ui-reference/ if it did)
- How many agents ran in total
- Top 3 architectural insights
- Any gaps (areas with thin coverage)
