import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL env var is required");
  process.exit(1);
}

const requiredRelations = [
  "public.breeze_broker_syncs",
  "public.breeze_broker_snapshots",
  "public.breeze_instrument_map",
  "public.news_sources",
  "public.news_sync_state",
  "public.event_stock_map",
  "public.user_news_providers",
  "public.mobile_sessions",
  "public.mobile_push_tokens",
  "public.mobile_trade_alert_state",
  "public.mobile_candidate_alert_state",
  "public.mobile_notification_log",
  "public.adaptive_allocation_strategies",
  "public.adaptive_allocation_runs",
  "public.breeze_auto_buy_settings",
  "public.breeze_order_intents",
  "public.ml_decision_calendar",
  "public.ml_universe_snapshots",
  "public.ml_feature_snapshots",
  "public.ml_labels",
  "public.ml_models",
  "public.ml_walk_forward_runs",
  "public.ml_promotion_decisions",
  "public.swing_predictions",
  "public.ml_serving_assignments",
  "public.ml_serving_assignment_history",
  "public.ml_monitor_observations",
];
const client = new pg.Client({
  connectionString: url,
  ssl: /127\.0\.0\.1|localhost/.test(url) ? false : { rejectUnauthorized: false },
});

try {
  await client.connect();
  const result = await client.query(
    "select name, to_regclass(name) relation from unnest($1::text[]) name",
    [requiredRelations],
  );
  const missing = result.rows.filter((row) => row.relation === null).map((row) => row.name);
  if (missing.length) throw new Error(`Required production relations are missing: ${missing.join(", ")}`);
  console.log(`Verified production schema: ${requiredRelations.join(", ")}`);
} catch (error) {
  console.error("Production schema verification failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await client.end();
}
