# Botpress ADK Agent

> This project is built with the **Botpress Agent Development Kit (ADK)** — a TypeScript-first framework for building AI agents.

## Key Files

- `agent.config.ts` — Agent configuration, models, and state schemas
- `.adk/dependencies/` — Generated local dependency snapshots; Botpress Cloud is the source of truth
- `src/conversations/` — Message handlers (primary user interaction)
- `src/workflows/` — Long-running background processes
- `src/tools/` — AI-callable functions
- `src/actions/` — Reusable business logic
- `src/knowledge/` — RAG knowledge base sources
- `src/tables/` — Database table definitions
- `src/triggers/` — Event-based triggers

## Development

```bash
adk dev      # Start dev server with hot reload
adk build    # Build and generate types
adk deploy   # Deploy to Botpress Cloud
adk chat     # Chat with your agent in the terminal
```

## CLI Commands (preferred interface)

Use CLI commands with `--format json` for structured output.

### Debugging & Testing

| Command                                       | Use for                                                                                  |
| --------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `adk check --format json`                     | Offline project validation — catch config and schema errors                              |
| `adk chat --single "<message>" --format json` | Test messages to the running bot (use --conversation-id <id> to continue a conversation) |
| `adk logs [error\|warning] --format json`     | Query dev server logs, build output, and errors                                          |
| `adk traces [filters...] --format json`       | Query trace spans for debugging conversations/workflows                                  |
| `adk status --format json`                    | Get project info: name, primitives, and integrations                                     |

### Dependencies (Integrations & Plugins)

Manage dependencies through the `adk integrations` / `adk plugins` CLI commands or the Integrations view in the dev console. Botpress Cloud is the source of truth; `.adk/dependencies/` contains generated local snapshots for fast/offline reads and should not be edited manually.

Use `adk dependencies export` / `adk dependencies import` when you need a dependency-only restore artifact. These commands save or load one environment's integration/plugin state as explicit JSON; they do not make `.adk/dependencies/` user-authored.

**Integrations** (external services: Slack, webchat, etc.)

| Command                             | Use for                                                  |
| ----------------------------------- | -------------------------------------------------------- |
| `adk integrations add <name>`       | Add an integration                                       |
| `adk integrations remove <name>`    | Remove an integration                                    |
| `adk integrations list`             | List installed integrations                              |
| `adk integrations search <query>`   | Search available integrations on the Botpress Hub        |
| `adk integrations info <name>`      | Get detailed info about an integration                   |
| `adk integrations copy --from --to` | Copy integration state between dev and prod environments |
| `adk dependencies export [file]`    | Save the current dependency state for one environment    |
| `adk dependencies import <file>`    | Restore dependency state into one environment            |

**Plugins** (reusable bot capabilities)

| Command                        | Use for                                |
| ------------------------------ | -------------------------------------- |
| `adk plugins add <name>`       | Add a plugin                           |
| `adk plugins remove <name>`    | Remove a plugin                        |
| `adk plugins list`             | List installed plugins                 |
| `adk plugins search <query>`   | Search available plugins               |
| `adk plugins info <name>`      | Get detailed info about a plugin       |
| `adk plugins copy --from --to` | Copy plugin state between dev and prod |

### Workflows

| Command                                              | Use for                                            |
| ---------------------------------------------------- | -------------------------------------------------- |
| `adk workflows list --format json`                   | Discover available workflows                       |
| `adk workflows inspect <name> --format json`         | Get workflow input schema                          |
| `adk workflows run <name> '<payload>' --format json` | Execute a workflow                                 |
| `adk workflows runs [filters] --format json`         | List workflow runs                                 |
| `adk workflows runs <wrkflow_id> --format json`      | Inspect a single run (status + state + step cache) |

> **Tip:** The dev server must be running (`adk dev`) for testing and trace tools to work.

### Skills

`adk init` creates the Agent(0) project capability bundle at `.agent0/capabilities` and installs public ADK skills/commands for external coding harnesses. If the Agent(0) bundle is missing or stale after an ADK upgrade, run `adk agent0 upgrade`.

## Project Overview

<!-- Describe what your agent does -->

## Architecture & Conventions

<!-- Add project-specific patterns, decisions, and conventions -->

## Notes

<!-- Add anything else relevant to your project -->
