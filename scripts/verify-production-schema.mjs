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
  "public.mobile_alert_preferences",
  "public.daily_delivery_metrics",
  "public.eod_asset_features",
  "public.eod_asset_features_meta",
  "public.news_stock_briefs",
  "public.ml_readiness_checks",
  "public.sector_group_memberships",
  "public.sector_thrust_runs",
  "public.sector_thrust_groups",
  "public.sector_thrust_members",
  "public.swing_trade_recovery_state",
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
  ["eod_asset_features", "asset_id"],
  ["eod_asset_features", "market"],
  ["eod_asset_features", "latest_date"],
  ["eod_asset_features", "last_close"],
  ["eod_asset_features", "history_count_200"],
  ["eod_asset_features", "history_count_253"],
  ["eod_asset_features", "sma20"],
  ["eod_asset_features", "sma50"],
  ["eod_asset_features", "sma200"],
  ["eod_asset_features", "high20"],
  ["eod_asset_features", "traded_value20"],
  ["eod_asset_features", "c21"],
  ["eod_asset_features", "c63"],
  ["eod_asset_features", "c126"],
  ["eod_asset_features", "c189"],
  ["fundamentals_sync_state", "error_code"],
  ["fundamentals_sync_state", "next_retry_at"],
  ["fundamentals_sync_state", "failure_count"],
  ["eod_asset_features", "c252"],
  ["eod_asset_features", "armed_rs_percentile"],
  ["eod_asset_features", "two_close_hold"],
  ["eod_asset_features", "refreshed_at"],
  ["eod_asset_features_meta", "market"],
  ["eod_asset_features_meta", "cutoff_date"],
  ["eod_asset_features_meta", "latest_bar_date"],
  ["eod_asset_features_meta", "row_count"],
  ["eod_asset_features_meta", "refreshed_at"],
  ["mobile_alert_preferences", "user_id"],
  ["mobile_alert_preferences", "execution_ready"],
  ["mobile_alert_preferences", "midway_setups"],
  ["mobile_alert_preferences", "ledger_risk_alerts"],
  ["mobile_alert_preferences", "news_high_impact"],
  ["mobile_alert_preferences", "quiet_hours_enabled"],
  ["mobile_alert_preferences", "updated_at"],
  ["latest_quotes", "session_volume"],
  ["latest_quotes", "session_volume_date"],
  ["latest_quotes", "session_volume_source"],
  ["latest_quotes", "session_volume_at"],
  ["sector_group_memberships", "taxonomy_version"],
  ["sector_group_memberships", "broad_sector"],
  ["sector_group_memberships", "industry_group"],
  ["sector_thrust_runs", "rule_version"],
  ["sector_thrust_runs", "taxonomy_version"],
  ["sector_thrust_runs", "unclassified_count"],
  ["sector_thrust_groups", "price_fresh_count"],
  ["sector_thrust_groups", "volume_fresh_count"],
  ["sector_thrust_groups", "volume_confirmation_route"],
  ["sector_thrust_groups", "first_triggered_at"],
  ["sector_thrust_members", "atr_extension"],
  ["swing_trade_ledger", "first_stop_breached_at"],
  ["swing_trade_ledger", "first_stop_breach_price"],
  ["swing_trade_ledger", "first_stop_breach_source"],
  ["swing_trade_recovery_state", "recovery_status"],
  ["swing_trade_recovery_state", "headline"],
  ["swing_trade_recovery_state", "move_2d_pct"],
  ["swing_trade_recovery_state", "sector_thrust_group"],
];
const requiredRlsRelations = [
  "adaptive_allocation_runs", "adaptive_allocation_strategies", "armed_swing_plans", "breeze_auto_buy_settings",
  "breeze_broker_snapshots", "breeze_broker_syncs", "breeze_order_actions",
  "breeze_order_events", "breeze_order_intents", "browser_notification_events",
  "candidate_signal_observations", "cas_holding_details", "cas_import_rejected_holdings",
  "email_digest_deliveries", "email_preferences", "forward_test_positions",
  "gmail_attachment_imports", "gmail_connections", "gmail_disclosure_attachments",
  "gmail_oauth_states", "holdings", "mobile_alert_preferences",
  "mobile_candidate_alert_state", "mobile_mutation_idempotency", "mobile_notification_log",
  "mobile_push_tokens", "mobile_trade_alert_state", "portfolios", "saved_screens",
  "swing_execution_plans", "swing_pending_order_fills", "swing_pending_orders",
  "swing_trade_exits", "swing_trade_ledger", "swing_trade_recovery_state", "transactions", "user_credentials",
  "user_fund_mappings", "user_mutual_fund_holdings", "user_news_providers",
  "user_swing_settings", "watchlist_items", "watchlists",
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
  const rls = await client.query(
    `select c.relname, c.relrowsecurity,
            exists (
              select 1 from pg_policy p
               where p.polrelid=c.oid and p.polroles @> array[(select oid from pg_roles where rolname='investogenie_web')]
            ) policy_ready
       from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname=any($1::text[])`,
    [requiredRlsRelations],
  );
  const rlsByTable = new Map(rls.rows.map((row) => [row.relname, row]));
  const missingRls = requiredRlsRelations.filter((name) => {
    const row = rlsByTable.get(name);
    return !row?.relrowsecurity || !row?.policy_ready;
  });
  if (missingRls.length) throw new Error(`Required tenant RLS policies are missing: ${missingRls.join(", ")}`);
  const kindCheck = await client.query(
    `select pg_get_constraintdef(c.oid) def
       from pg_constraint c
       join pg_class t on t.oid = c.conrelid
       join pg_namespace n on n.oid = t.relnamespace
      where n.nspname = 'public'
        and t.relname = 'browser_notification_events'
        and c.conname = 'browser_notification_events_kind_check'`,
  );
  if (!kindCheck.rows[0]?.def?.includes("NEWS_RISK")) {
    throw new Error("browser_notification_events_kind_check is missing NEWS_RISK (apply 0092_news_risk_notifications.sql)");
  }
  console.log(`Verified production schema: ${requiredRelations.join(", ")}`);
} catch (error) {
  console.error("Production schema verification failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await client.end();
}
