# InvestoGenie documentation index

_Reconciled 17 November 2026 through deployed revision `784f894`._

Use [GEMINI.md](GEMINI.md) when handing this system to a reader who has the files but not the checkout; it points at the two documents that stand alone. Use [AI_REVIEW_HANDOFF.md](AI_REVIEW_HANDOFF.md) when handing the repository to another AI reviewer. The index below explains the scope of every Markdown document; generated machine-local Claude context is not part of the product contract.

| Document | Scope |
| --- | --- |
| `README.md` | Product entry point, routes, stack, setup and release commands |
| `AI_REVIEW_HANDOFF.md` | External AI review brief, invariants, evidence and requested finding format |
| `ARCHITECTURE.md` | Runtime, repository and calculation ownership boundaries |
| `CAPABILITIES.md` | Implemented application behavior |
| `STATUS.md` | Dated source/production verification and known gaps |
| `DEPLOYMENT.md` | Environment separation and production promotion workflow |
| `GEMINI.md` | Entry point for a reader without the checkout; routes to the two standalone documents |
| `AGENTS.md` | Mandatory coding, testing, safety and deployment instructions for coding agents |
| `CLAUDE.md` | Claude-specific pointer and machine-generated local session context; not an application contract |
| `README-screener.md` | Stock Screener filters, data and limits |
| `docs/MODULE_INDEX.md` | Routing table from module to guide, entry points and calculation owner |
| `docs/modules/*.md` | One guide per module: description, then boundaries and invariants |
| `docs/swing-strategies.md` | Exact Swing, Strong Swing, Armed and named-strategy rules |
| `docs/ml-methodology.md` | ML production lifecycle contract and frozen semantics |
| `docs/EMAIL_SETUP.md` | Digest configuration and operational limits |
| `docs/QUICK_START_CREDENTIALS.md` | Short credential setup guide |
| `docs/SECURE_CREDENTIALS.md` | Credential encryption and provider setup |
| `deploy/local/README.md` | macOS local service installation |
| `deploy/oracle/README.md` | AWS Lightsail/Ubuntu bootstrap and releases |
| `mobile/README.md` | Mobile client development and distribution |
| `mobile/PRIVACY.md` | Mobile data and notification privacy boundary |

## Authority order

1. Current source code and database migrations.
2. `AGENTS.md` for repository workflow and protected financial logic.
3. `docs/swing-strategies.md` and `docs/ml-methodology.md` for versioned financial contracts.
4. `ARCHITECTURE.md`, `CAPABILITIES.md` and `STATUS.md` for system behavior and dated evidence.
5. Setup and product guides.

Documentation cannot establish continuing provider freshness, profitability, a deployed mobile binary, or an active ML serving assignment. Those require runtime evidence.
