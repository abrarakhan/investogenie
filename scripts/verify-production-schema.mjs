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
  "public.candidate_signal_observations",
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
  "public.corporate_events",
  "public.corporate_event_sync_state",
  "public.armed_swing_plans",
  "public.user_invitations",
  "public.swing_pending_orders",
  "public.swing_pending_order_fills",
  "public.swing_execution_plans",
  "public.screener_technical_daily",
  "public.screener_fundamental_latest",
  "public.asset_shareholding_reports",
  "public.trend_continuation_signals",
  "public.browser_notification_events",
  "public.asset_symbol_changes",
  "public.strategy_retrospective_results",
  "public.strategy_retrospective_scorecards",
  "public.intraday_bars",
  "public.market_volume_curves",
  "public.breeze_order_events",
  "public.breeze_order_actions",
  "public.email_digest_deliveries",
  "public.mobile_mutation_idempotency",
  "public.daily_delivery_metrics",
];
const requiredColumns = [
  ["corporate_event_sync_state", "authoritative_source"],
  ["corporate_event_sync_state", "authoritative_as_of"],
  ["corporate_event_sync_state", "authoritative_coverage_from"],
  ["corporate_event_sync_state", "authoritative_coverage_through"],
  ["corporate_event_sync_state", "authoritative_imported_at"],
  ["gmail_connections", "last_error"],
  ["gmail_connections", "last_error_at"],
  ["gmail_connections", "needs_reconnect"],
  ["stock_snapshot", "distance_sma_200_pct"],
  ["browser_notification_events", "market_date"],
  ["users", "role"],
  ["users", "is_system_owner"],
  ["strong_swing_snapshots", "benchmark_asset_id"],
  ["strong_swing_snapshots", "benchmark_latest_bar_date"],
  ["screener_technical_daily", "change_pct_1d"],
  ["stock_snapshot", "profit_cagr_3y"],
  ["stock_snapshot", "promoter_holding_change_qoq"],
  ["stock_snapshot", "deliv_pct"],
  ["stock_snapshot", "rel_deliv_20d"],
  ["stock_snapshot", "nifty_alpha_1d"],
  ["stock_snapshot", "ibs_close"],
  ["stock_snapshot", "tod_rvol"],
  ["stock_snapshot", "days_since_results"],
  ["stock_snapshot", "setup_variant"],
  ["stock_snapshot", "catalyst_tag"],
  ["trend_continuation_signals", "setup_variant"],
  ["trend_continuation_signals", "deliv_pct"],
  ["trend_continuation_signals", "rel_deliv_20d"],
  ["trend_continuation_signals", "ibs_close"],
  ["trend_continuation_signals", "nifty_alpha_1d"],
  ["trend_continuation_signals", "tod_rvol"],
  ["trend_continuation_signals", "catalyst_tag"],
  ["trend_continuation_signals", "days_since_results"],
  ["screener_technical_daily", "deliv_pct"],
  ["screener_technical_daily", "rel_deliv_20d"],
  ["screener_technical_daily", "ibs_close"],
  ["screener_technical_daily", "nifty_alpha_1d"],
  ["screener_technical_daily", "tod_rvol"],
  ["screener_technical_daily", "setup_variant"],
  ["screener_technical_daily", "catalyst_tag"],
  ["screener_technical_daily", "days_since_results"],
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
  const columns = await client.query(
    `select table_name,column_name from information_schema.columns
      where table_schema='public' and (table_name,column_name) in (
        select * from unnest($1::text[],$2::text[])
      )`,
    [requiredColumns.map(([table]) => table), requiredColumns.map(([, column]) => column)],
  );
  const present = new Set(columns.rows.map((row) => `${row.table_name}.${row.column_name}`));
  const missingColumns = requiredColumns
    .map(([table, column]) => `${table}.${column}`)
    .filter((name) => !present.has(name));
  if (missingColumns.length) throw new Error(`Required production columns are missing: ${missingColumns.join(", ")}`);
  console.log(`Verified production schema: ${requiredRelations.join(", ")}`);
} catch (error) {
  console.error("Production schema verification failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await client.end();
}
