# InvestoGenie documentation index

_Reconciled 14 November 2026 through deployed revision `f33f256`._

Use [AI_REVIEW_HANDOFF.md](AI_REVIEW_HANDOFF.md) when handing the repository to another AI reviewer. The index below explains the scope of every Markdown document; generated machine-local Claude context is not part of the product contract.

| Document | Scope |
| --- | --- |
| `README.md` | Product entry point, routes, stack, setup and release commands |
| `AI_REVIEW_HANDOFF.md` | External AI review brief, invariants, evidence and requested finding format |
| `ARCHITECTURE.md` | Runtime, repository and calculation ownership boundaries |
| `CAPABILITIES.md` | Implemented application behavior |
| `STATUS.md` | Dated source/production verification and known gaps |
| `DEPLOYMENT.md` | Environment separation and production promotion workflow |
| `AGENTS.md` | Mandatory coding, testing, safety and deployment instructions for coding agents |
| `CLAUDE.md` | Claude-specific pointer and machine-generated local session context; not an application contract |
| `README-screener.md` | Stock Screener filters, data and limits |
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
