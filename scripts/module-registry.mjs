export const MODULES = [
  {
    key: "momentum", guide: "docs/modules/momentum.md",
    paths: ["features/momentum/", "lib/momentumIgnition", "lib/momentumExecution", "lib/analytics/momentumIgnition", "components/screener/MomentumIgnition", "pipelines/strategy_math/momentum.py", "pipelines/test_momentum_strategy_math.py"],
    dependencies: ["server/strategy-bridge", "market-calendar", "execution-plans"],
    tests: ["npx vitest run lib/pythonStrategyMath.test.ts lib/momentumIgnitionCandidate.test.ts lib/momentumExecution.test.ts", "PYTHONPATH=pipelines .venv/bin/python -m unittest pipelines.test_momentum_strategy_math"],
  },
  {
    key: "swing", guide: "docs/modules/swing.md",
    paths: ["features/swing/", "lib/ingest/signals.ts", "lib/screener.ts", "lib/analytics/swingClassifier", "lib/analytics/legendaryStrategies", "lib/analytics/candidateRanking", "components/screener/Screener", "pipelines/strategy_math/swing_scan.py", "lib/swingScanParity.test.ts"],
    dependencies: ["server/strategy-bridge", "quotes", "fundamentals"],
    tests: ["npx vitest run lib/screener.test.ts lib/swingScanParity.test.ts lib/analytics/candidateRanking.test.ts"],
  },
  {
    key: "strong-swing", guide: "docs/modules/strong-swing.md",
    paths: ["features/strong-swing/", "lib/strongSwing", "lib/analytics/strongSwing", "components/screener/StrongSwing", "pipelines/strategy_math/strong_swing.py", "pipelines/strong_swing_parity.py", "pipelines/test_strong_swing_parity.py"],
    dependencies: ["swing", "results-calendar", "execution-plans"],
    tests: ["npx vitest run lib/strongSwingCaptureUpsert.test.ts", "PYTHONPATH=pipelines .venv/bin/python -m unittest pipelines.test_strong_swing_parity"],
  },
  {
    key: "armed-swing", guide: "docs/modules/armed-swing.md",
    paths: ["features/armed-swing/", "lib/armedSwing", "lib/analytics/armedSwing", "components/screener/ArmedSwing", "app/terminal/[market]/armed-swing", "pipelines/strategy_math/armed_swing.py", "pipelines/session_volume_curve_sync.py"],
    dependencies: ["swing", "results-calendar", "market-volume-curves", "pending-orders"],
    tests: ["npx vitest run lib/armedSwingPlans.test.ts"],
  },
  {
    key: "trend-continuation", guide: "docs/modules/trend-continuation.md",
    paths: ["features/trend-continuation/", "lib/trendContinuation", "components/screener/TrendContinuation", "pipelines/trend_continuation.py", "pipelines/strategy_math/trend_execution.py", "pipelines/test_trend_continuation.py"],
    dependencies: ["swing", "results-calendar", "execution-plans"],
    tests: ["PYTHONPATH=pipelines .venv/bin/python -m unittest pipelines.test_trend_continuation"],
  },
  {
    key: "stock-screener", guide: "docs/modules/stock-screener.md",
    paths: ["lib/screener/", "app/api/screener", "app/terminal/[market]/stocks", "components/stocks", "pipelines/screener_technical_features.py", "pipelines/test_screener_technical_features.py"],
    dependencies: ["market-data", "fundamentals", "saved-screens"],
    tests: ["npx vitest run lib/screener/filterEngine.test.ts lib/screener/nlQuery.test.ts", "PYTHONPATH=pipelines .venv/bin/python -m unittest pipelines.test_screener_technical_features"],
  },
  {
    key: "ledger", guide: "docs/modules/ledger.md",
    paths: ["lib/swingTradeLedger", "lib/swingTradeProjection", "lib/mobileLedgerMutations", "app/terminal/[market]/trade-ledger", "app/api/v1/mobile/trade-ledger", "components/trade-ledger", "pipelines/strategy_math/ledger.py"],
    dependencies: ["execution-plans", "quotes", "news"],
    tests: ["npx vitest run lib/swingTradeLedger.test.ts lib/ledgerParity.test.ts lib/ledgerTradeParity.test.ts lib/mobileMutationIdempotency.test.ts"],
  },
  {
    key: "news", guide: "docs/modules/news.md",
    paths: ["lib/news/", "lib/newsSwing", "lib/analytics/newsSwing", "app/terminal/[market]/news-swing", "app/api/v1/mobile/news-swing", "components/news"],
    dependencies: ["providers", "credentials", "ledger"],
    tests: ["npx vitest run lib/analytics/newsSwing.test.ts"],
  },
  {
    key: "long-term", guide: "docs/modules/long-term.md",
    paths: ["lib/long-term", "lib/analytics/longTermStrategies", "app/terminal/[market]/long-term", "components/long-term", "pipelines/strategy_math/long_term.py", "pipelines/test_long_term_strategy_math.py"],
    dependencies: ["fundamentals", "market-data"],
    tests: ["npx vitest run lib/longTermRules.test.ts", "PYTHONPATH=pipelines .venv/bin/python -m unittest pipelines.test_long_term_strategy_math"],
  },
  {
    key: "probability", guide: "docs/modules/probability.md",
    paths: ["lib/probability-runtime", "lib/analytics/probability", "app/terminal/[market]/probability", "components/probability", "pipelines/strategy_math/probability.py", "pipelines/test_probability_strategy_math.py"],
    dependencies: ["market-data", "forward-test"],
    tests: ["npx vitest run lib/forwardTestEngines.test.ts"],
  },
  {
    key: "adaptive-allocation", guide: "docs/modules/adaptive-allocation.md",
    paths: ["lib/adaptiveAllocation", "lib/analytics/adaptiveAllocationSelection", "lib/analytics/universalPortfolio", "app/terminal/[market]/adaptive-allocation", "components/adaptive"],
    dependencies: ["market-data", "broker"],
    tests: ["npx vitest run lib/analytics/adaptiveAllocationSelection.test.ts lib/analytics/universalPortfolio.test.ts"],
  },
  {
    key: "portfolio-funds", guide: "docs/modules/portfolio-funds.md",
    paths: ["lib/portfolio", "lib/cas/", "lib/funds/", "app/portfolio", "app/terminal/in/cas", "components/funds", "components/portfolio"],
    dependencies: ["auth", "fundamentals", "amfi"],
    tests: ["npx vitest run lib/cas lib/funds"],
  },
  {
    key: "notifications", guide: "docs/modules/notifications.md",
    paths: ["lib/mobileAlerts", "lib/browserNotification", "lib/email-digest", "app/api/browser-notifications", "app/api/v1/mobile/push-token", "app/api/cron/mobile-alerts", "app/api/cron/send-email-digest"],
    dependencies: ["candidate-observations", "push", "email"],
    tests: ["npx vitest run lib/emailDigestIdempotency.test.ts lib/mobileAlerts.test.ts"],
  },
  {
    key: "mobile", guide: "docs/modules/mobile.md",
    paths: ["mobile/", "app/api/v1/mobile/", "lib/mobileScreens", "lib/mobileSession", "lib/mobileMutation", "lib/mobileHttp"],
    dependencies: ["mobile-api-contracts", "auth", "notifications"],
    tests: ["npm --prefix mobile run typecheck", "npx vitest run lib/mobileScreens.test.ts lib/mobileFeatureRegistry.test.ts lib/mobileMutationIdempotency.test.ts lib/mobileHttp.test.ts"],
  },
  {
    key: "market", guide: "docs/modules/market.md",
    paths: ["lib/marketOverview", "lib/engines-runtime", "app/terminal/[market]/page.tsx", "components/dashboard"],
    dependencies: ["market-data", "swing", "portfolio"],
    tests: ["npx vitest run lib/market-calendar.test.ts lib/forwardTestEngines.test.ts"],
  },
  {
    key: "operations", guide: "docs/modules/operations.md",
    paths: ["scripts/", "workers/", "deploy/", "db/migrations/", "app/data/health", "app/admin/sync", "docs/modules/operations.md"],
    dependencies: ["database", "providers", "deployment"],
    tests: [],
  },
];

export function modulesForFiles(files) {
  const normalized = files.map((file) => file.replaceAll("\\", "/"));
  return MODULES.filter((entry) => normalized.some((file) =>
    file === entry.guide || entry.paths.some((part) => file.includes(part))));
}
