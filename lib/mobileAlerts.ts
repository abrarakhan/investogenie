import { workerQuery } from "@/lib/db";
import { getMomentumBothCandidates, type MomentumBothResult } from "@/features/momentum/service";
import { getUserSwingSettings, type SwingSettings } from "@/lib/settings";
import { getStrongSwingCandidates, type StrongSwingCandidate } from "@/features/strong-swing/service";
import { getSwingTradeLedger, type SwingLedgerTrade } from "@/lib/swingTradeLedger";
import { advanceRecoveryAlertState, buildRecoveryTransitionAlerts, type RecoveryAlertCandidate } from "@/lib/tradeRecoveryAlerts";
import { markLiveMarketTargets } from "@/lib/liveMarketTargets";
import { isMarketOpenNow } from "@/lib/market-calendar.mjs";
import { getMobileAlertPreferences, type MobileAlertPreferences } from "@/lib/mobileAlertPreferences";
import { getTrendContinuationCandidates, type TrendContinuationCandidate } from "@/features/trend-continuation/service";
import {
  seedMomentumBoth,
  seedStrongSwing,
  seedTrendContinuation,
  swingSettingsKey,
} from "@/lib/displayScanCache";

export function tradeAlertSignature(trade: SwingLedgerTrade): string | null {
  if (trade.status !== "OPEN" || trade.risk.recommendation === "STAY") return null;
  // Reasons contain live percentages and explanatory copy. They can change on
  // every quote without changing the action the user should take, so they must
  // never be part of notification identity.
  return [trade.id, trade.risk.recommendation, trade.risk.state, trade.progress.state].join("|");
}

export function shouldSendTradeAlert(previousSignature: string | null, nextSignature: string): boolean {
  return previousSignature !== nextSignature;
}

interface PushTokenRow { id: string; user_id: string; expo_push_token: string }
interface AlertStateRow { last_signature: string }
interface CandidateAlertStateRow { was_ready: boolean; last_status: string; last_sent_at: string | null }
type CandidateEngine = "STRONG_SWING" | "MOMENTUM_IGNITION" | "MOMENTUM_IGNITION_V2" | "TREND_CONTINUATION";
interface CandidateSignal {
  assetId: string;
  ticker: string;
  engine: CandidateEngine;
  status: string;
  ready: boolean;
  earlyWatch?: boolean;
  midway?: boolean;
  quoteAsOf: string | null;
}

export function candidateAlertAllowed(
  preferences: MobileAlertPreferences,
  candidate: Pick<CandidateSignal, "midway">,
  marketOpen: boolean,
): boolean {
  if (preferences.quietHoursEnabled && !marketOpen) return false;
  return candidate.midway ? preferences.midwaySetups : preferences.executionReady;
}

export function tradeAlertAllowed(preferences: MobileAlertPreferences): boolean {
  return preferences.ledgerRiskAlerts;
}

export function newsAlertAllowed(preferences: MobileAlertPreferences, marketOpen: boolean): boolean {
  if (!preferences.newsHighImpact) return false;
  if (preferences.quietHoursEnabled && !marketOpen) return false;
  return true;
}

function mobileScreenForEngine(engine: CandidateEngine): "strong-swing" | "momentum-v2" | "trend-continuation" {
  if (engine === "TREND_CONTINUATION") return "trend-continuation";
  if (engine === "MOMENTUM_IGNITION_V2") return "momentum-v2";
  return "strong-swing";
}

function candidateAlertDestination(market: "IN" | "US", engine: CandidateEngine) {
  const section = engine === "STRONG_SWING" ? "strong-swing"
    : engine === "MOMENTUM_IGNITION" ? "momentum-ignition"
    : engine === "MOMENTUM_IGNITION_V2" ? "momentum-ignition-v2" : "trend-continuation";
  return `/terminal/${market.toLowerCase()}/strong-swing#${section}`;
}

async function sendExpoMessages(tokens: PushTokenRow[], message: {
  title: string;
  body: string;
  screen: "ledger" | "strong-swing" | "momentum-v2" | "trend-continuation" | "news-swing";
  market?: "IN" | "US";
}) {
  if (!tokens.length) return [];
  // Financial details never leave InvestoGenie. The authenticated app fetches them after opening.
  const response = await fetch("https://exp.host/--/api/v2/push/send", {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify(tokens.map((token) => ({
      to: token.expo_push_token,
      sound: "default",
      priority: "high",
      title: message.title,
      body: message.body,
      data: { screen: message.screen, market: message.market },
    }))),
  });
  const payload = await response.json().catch(() => ({})) as {
    data?: Array<{ status: string; details?: { error?: string } }>;
  };
  if (!response.ok) throw new Error(`Expo push service failed (${response.status})`);
  return payload.data ?? [];
}

async function recordDisabledTokens(tokens: PushTokenRow[], receipts: Array<{ status: string; details?: { error?: string } }>) {
  let sentCount = 0;
  let failedCount = 0;
  for (let index = 0; index < receipts.length; index += 1) {
    const receipt = receipts[index];
    if (receipt?.status === "ok") sentCount += 1;
    else {
      failedCount += 1;
      if (receipt?.details?.error === "DeviceNotRegistered") {
        await workerQuery(`update public.mobile_push_tokens set enabled=false,updated_at=now() where id=$1`, [tokens[index].id]);
      }
    }
  }
  return { sentCount, failedCount };
}

interface AlertRunCache {
  strong: Map<string, Promise<StrongSwingCandidate[]>>;
  momentum: Map<string, Promise<MomentumBothResult>>;
  trend: Map<string, Promise<TrendContinuationCandidate[]>>;
}

function createAlertRunCache(): AlertRunCache {
  return { strong: new Map(), momentum: new Map(), trend: new Map() };
}

function cachedByKey<T>(map: Map<string, Promise<T>>, key: string, compute: () => Promise<T>): Promise<T> {
  const existing = map.get(key);
  if (existing) return existing;
  const pending = compute();
  map.set(key, pending);
  return pending;
}

async function candidateSignals(
  market: "IN" | "US",
  userId: string,
  runCache?: AlertRunCache,
): Promise<CandidateSignal[]> {
  const settings: SwingSettings = await getUserSwingSettings(userId);
  const sKey = `${market}:${swingSettingsKey(settings)}`;
  const computeStrong = async () => {
    const value = await getStrongSwingCandidates(market, settings);
    seedStrongSwing(market, settings, value);
    return value;
  };
  const computeMomentum = async () => {
    const value = await getMomentumBothCandidates(market, settings);
    seedMomentumBoth(market, settings, value);
    return value;
  };
  const computeTrend = async () => {
    if (market !== "IN") return [] as TrendContinuationCandidate[];
    const value = await getTrendContinuationCandidates(market);
    seedTrendContinuation(market, value);
    return value;
  };
  const [strong, momentumBoth, continuation] = await Promise.all([
    runCache ? cachedByKey(runCache.strong, sKey, computeStrong) : computeStrong(),
    runCache ? cachedByKey(runCache.momentum, sKey, computeMomentum) : computeMomentum(),
    runCache ? cachedByKey(runCache.trend, market, computeTrend) : computeTrend(),
  ]);
  const { legacy, v2 } = momentumBoth;
  const signals: CandidateSignal[] = [
    ...strong.map((candidate) => ({
      assetId: candidate.assetId, ticker: candidate.ticker, engine: "STRONG_SWING" as const,
      status: candidate.status, ready: candidate.status === "EXECUTION_READY", quoteAsOf: candidate.asOf,
    })),
    ...legacy.candidates.map((candidate) => ({
      assetId: candidate.assetId, ticker: candidate.ticker, engine: "MOMENTUM_IGNITION" as const,
      status: candidate.status, ready: candidate.status === "ENTRY_READY", quoteAsOf: candidate.quoteUpdatedAt,
    })),
    ...v2.candidates.map((candidate) => ({
      assetId: candidate.assetId, ticker: candidate.ticker, engine: "MOMENTUM_IGNITION_V2" as const,
      status: candidate.status, ready: candidate.status === "MOMENTUM_READY", quoteAsOf: candidate.quoteUpdatedAt,
    })),
    ...continuation.map((candidate) => ({
      assetId: candidate.assetId, ticker: candidate.ticker, engine: "TREND_CONTINUATION" as const,
      status: candidate.status, ready: candidate.executionEligible,
      earlyWatch: candidate.metrics.developing_staircase === true
        && candidate.metrics.execution_data_verified === true,
      midway: typeof candidate.metrics.setup_variant === "string",
      quoteAsOf: candidate.computedAt,
    })),
  ];
  await markLiveMarketTargets(signals.map((candidate) => candidate.assetId), "strong_swing");
  return signals;
}

async function dispatchCandidateAlerts(
  userId: string,
  tokens: PushTokenRow[],
  market: "IN" | "US",
  runCache: AlertRunCache,
  preferences: MobileAlertPreferences,
) {
  const candidates = await candidateSignals(market, userId, runCache);
  const readyByEngine = new Map<CandidateEngine, string[]>();
  for (const engine of ["STRONG_SWING", "MOMENTUM_IGNITION", "MOMENTUM_IGNITION_V2", "TREND_CONTINUATION"] as const) {
    readyByEngine.set(engine, candidates.filter((candidate) => candidate.engine === engine && candidate.ready).map((candidate) => candidate.assetId));
    await workerQuery(
      `update public.mobile_candidate_alert_state set was_ready=false,last_seen_at=now()
        where user_id=$1 and market=$2 and engine=$3
          and not (asset_id = any($4::uuid[]))`,
      [userId, market, engine, readyByEngine.get(engine)],
    );
  }
  let alerts = 0;
  let delivered = 0;
  for (const candidate of candidates) {
    const notificationAllowed = candidateAlertAllowed(preferences, candidate, isMarketOpenNow(market));
    const previous = await workerQuery<CandidateAlertStateRow>(
      `select was_ready,last_status,last_sent_at from public.mobile_candidate_alert_state
        where user_id=$1 and market=$2 and engine=$3 and asset_id=$4`,
      [userId, market, candidate.engine, candidate.assetId],
    );
    const newlyReady = candidate.ready && previous[0]?.was_ready !== true;
    const transitioned = candidate.ready && tokens.length > 0
      && (previous[0]?.was_ready !== true || !previous[0]?.last_sent_at);
    const statusChanged = previous[0]?.last_status !== candidate.status
      || previous[0]?.was_ready !== candidate.ready;
    let sentCount = 0;
    let failedCount = 0;
    if (newlyReady && notificationAllowed) {
      const engineLabel = candidate.engine === "STRONG_SWING" ? "Strong Swing"
        : candidate.engine === "MOMENTUM_IGNITION" ? "Momentum Ignition"
        : candidate.engine === "MOMENTUM_IGNITION_V2" ? "Momentum Ignition V2" : "Trend Continuation";
      const statusLabel = candidate.status === "EXECUTION_READY" ? "Execution Ready"
        : candidate.status === "TREND_CONTINUATION_READY" ? "Continuation Ready" : "Momentum Ready";
      await workerQuery(
        `insert into public.browser_notification_events
           (user_id,market,kind,asset_id,title,body,route,signature,market_date)
         values($1,$2,'CANDIDATE_READY',$3,$4,$5,$6,$7,
           (now() at time zone case when $2='IN' then 'Asia/Kolkata' else 'America/New_York' end)::date)
         on conflict(user_id,signature,market_date) do nothing`,
        [userId, market, candidate.assetId, `InvestoGenie: ${engineLabel} · ${statusLabel}`,
          `${candidate.ticker} entered ${statusLabel} in ${engineLabel}. Open that section to review it.`,
          candidateAlertDestination(market, candidate.engine), `${candidate.engine}|${candidate.assetId}|${candidate.status}`],
      );
    }
    if (candidate.earlyWatch === true && notificationAllowed) {
      await workerQuery(
        `insert into public.browser_notification_events
           (user_id,market,kind,asset_id,title,body,route,signature,market_date)
         values($1,$2,'CANDIDATE_WATCH',$3,$4,$5,$6,$7,
           (now() at time zone case when $2='IN' then 'Asia/Kolkata' else 'America/New_York' end)::date)
         on conflict(user_id,signature,market_date) do nothing`,
        [userId, market, candidate.assetId, "InvestoGenie: Trend Continuation · Staircase developing",
          `${candidate.ticker} is building a two-session continuation staircase. Observation only; wait for confirmation.`,
          candidateAlertDestination(market, candidate.engine),
          `${candidate.engine}|${candidate.assetId}|DEVELOPING_STAIRCASE`],
      );
    }
    if (transitioned && notificationAllowed) {
      const engineLabel = candidate.engine === "STRONG_SWING" ? "Strong Swing"
        : candidate.engine === "MOMENTUM_IGNITION" ? "Momentum Ignition"
        : candidate.engine === "MOMENTUM_IGNITION_V2" ? "Momentum Ignition V2" : "Trend Continuation";
      const statusLabel = candidate.status === "EXECUTION_READY" ? "Execution Ready"
        : candidate.status === "TREND_CONTINUATION_READY" ? "Continuation Ready" : "Momentum Ready";
      const receipts = await sendExpoMessages(tokens, {
        title: `InvestoGenie: ${statusLabel}`,
        body: `${candidate.ticker} entered ${statusLabel} in ${engineLabel}. Open ${engineLabel} to review it.`,
        screen: mobileScreenForEngine(candidate.engine), market,
      });
      ({ sentCount, failedCount } = await recordDisabledTokens(tokens, receipts));
      alerts += 1;
      delivered += sentCount;
      await workerQuery(
        `insert into public.mobile_notification_log
           (user_id,asset_id,engine,market,recommendation,signature,quote_updated_at,sent_count,failed_count)
         values($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [userId, candidate.assetId, candidate.engine, market, candidate.status,
          `${candidate.engine}|${candidate.status}`, candidate.quoteAsOf, sentCount, failedCount],
      );
    }
    if (statusChanged) {
      await workerQuery(
        `insert into public.candidate_signal_observations
           (user_id,market,engine,asset_id,status,ready,quote_as_of)
         values($1,$2,$3,$4,$5,$6,$7)`,
        [userId, market, candidate.engine, candidate.assetId, candidate.status,
          candidate.ready, candidate.quoteAsOf],
      );
    }
    await workerQuery(
      `insert into public.mobile_candidate_alert_state
         (user_id,market,engine,asset_id,last_status,was_ready,last_seen_at,last_sent_at)
         values($1,$2,$3,$4,$5,$6,now(),case when $7 then now() else null end)
       on conflict(user_id,market,engine,asset_id) do update set
         last_status=excluded.last_status,was_ready=excluded.was_ready,last_seen_at=now(),
         last_sent_at=case when $7 then now() else mobile_candidate_alert_state.last_sent_at end`,
      [userId, market, candidate.engine, candidate.assetId, candidate.status, candidate.ready, sentCount > 0],
    );
  }
  return { evaluated: candidates.length, alerts, delivered };
}

async function dispatchHighImpactNewsAlerts(
  userId: string,
  tokens: PushTokenRow[],
  market: "IN" | "US",
  preferences: MobileAlertPreferences,
): Promise<{ alerts: number; delivered: number }> {
  if (!newsAlertAllowed(preferences, isMarketOpenNow(market))) return { alerts: 0, delivered: 0 };
  const rows = await workerQuery<{ asset_id: string; ticker: string; verdict: string; summary: string }>(
    `select b.asset_id::text, a.ticker, b.verdict, b.summary
       from public.news_stock_briefs b
       join public.assets a on a.id = b.asset_id
      where b.market = $1
        and b.verdict = 'FILTER_OUT'
        and b.generated_at >= now() - interval '24 hours'
        and (
          exists (select 1 from public.swing_trade_ledger l where l.user_id = $2 and l.asset_id = b.asset_id and l.status = 'OPEN')
          or exists (select 1 from public.watchlist_items w where w.user_id = $2 and w.asset_id = b.asset_id)
        )
        and not exists (
          select 1 from public.browser_notification_events e
           where e.user_id = $2
             and e.market = $1
             and e.asset_id = b.asset_id
             and e.kind = 'NEWS_RISK'
             and e.signature = 'NEWS_HIGH_IMPACT|' || b.asset_id::text || '|' || b.verdict
             and e.market_date = (now() at time zone case when $1 = 'IN' then 'Asia/Kolkata' else 'America/New_York' end)::date
        )
      order by b.generated_at desc
      limit 5`,
    [market, userId],
  ).catch((error) => {
    console.error("[mobile-alerts] failed to query high-impact news briefs:", error);
    return [];
  });

  let alerts = 0;
  let delivered = 0;
  for (const row of rows) {
    const signature = `NEWS_HIGH_IMPACT|${row.asset_id}|${row.verdict}`;
    let inserted: Array<{ id: string }>;
    try {
      inserted = await workerQuery<{ id: string }>(
        `insert into public.browser_notification_events
           (user_id,market,kind,asset_id,title,body,route,signature,market_date)
         values($1,$2,'NEWS_RISK',$3,$4,$5,$6,$7,
           (now() at time zone case when $2='IN' then 'Asia/Kolkata' else 'America/New_York' end)::date)
         on conflict(user_id,signature,market_date) do nothing
         returning id::text`,
        [
          userId, market, row.asset_id,
          `InvestoGenie: High-impact news · ${row.ticker}`,
          row.summary.slice(0, 180),
          `/terminal/${market.toLowerCase()}/news-swing`,
          signature,
        ],
      );
    } catch (error) {
      console.error(`[mobile-alerts] failed to insert NEWS_RISK notification for ${row.ticker}:`, error);
      continue;
    }
    if (!inserted.length) continue;
    alerts += 1;
    if (tokens.length) {
      const receipts = await sendExpoMessages(tokens, {
        title: `InvestoGenie: High-impact news`,
        body: `High-impact adverse news flagged for a tracked ${market} stock. Open News & AI to review.`,
        screen: "news-swing",
        market,
      });
      const { sentCount } = await recordDisabledTokens(tokens, receipts);
      delivered += sentCount;
    }
  }
  return { alerts, delivered };
}

interface RecoveryAlertStateRow {
  trade_id: string;
  last_alerted_recovery_status: string | null;
  last_alerted_fresh_setup_key: string | null;
}

async function dispatchTradeRecoveryAlerts(
  userId: string,
  tokens: PushTokenRow[],
  market: "IN" | "US",
  trades: SwingLedgerTrade[],
  preferences: MobileAlertPreferences,
): Promise<{ browserCreated: number; expoDelivered: number }> {
  const openWithRecovery = trades.filter((t) => t.status === "OPEN" && t.recovery);
  if (!openWithRecovery.length) return { browserCreated: 0, expoDelivered: 0 };

  const stateRows = await workerQuery<RecoveryAlertStateRow>(
    `select trade_id::text, last_alerted_recovery_status, last_alerted_fresh_setup_key
       from public.swing_trade_recovery_state
      where user_id = $1 and market = $2`,
    [userId, market],
  ).catch((error) => {
    console.error("[mobile-alerts] failed to load recovery alert state:", error);
    return [];
  });
  const stateByTrade = new Map(stateRows.map((row) => [row.trade_id, row]));

  let browserCreated = 0;
  let expoDelivered = 0;
  for (const trade of openWithRecovery) {
    const prevRow = stateByTrade.get(trade.id);
    const prevState = {
      lastAlertedRecoveryStatus: prevRow?.last_alerted_recovery_status ?? null,
      lastAlertedFreshSetupKey: prevRow?.last_alerted_fresh_setup_key ?? null,
    };
    const evalResult = buildRecoveryTransitionAlerts(trade, prevState);
    if (!evalResult.stateChanged || !evalResult.alerts.length) continue;

    if (!tradeAlertAllowed(preferences)) {
      await workerQuery(
        `update public.swing_trade_recovery_state
            set last_alerted_recovery_status = $1,
                last_alerted_fresh_setup_key = $2,
                last_alerted_at = now()
          where trade_id = $3::uuid and user_id = $4::uuid`,
        [evalResult.nextRecoveryStatus, evalResult.nextFreshSetupKey, trade.id, userId],
      );
      continue;
    }

    const claimed: RecoveryAlertCandidate[] = [];
    for (const candidate of evalResult.alerts) {
      let inserted: Array<{ id: string }>;
      try {
        inserted = await workerQuery<{ id: string }>(
          `insert into public.browser_notification_events
             (user_id,market,kind,asset_id,trade_id,title,body,route,signature,market_date)
           values($1,$2,'TRADE_RECOVERY',$3,$4,$5,$6,$7,$8,
             (now() at time zone case when $2='IN' then 'Asia/Kolkata' else 'America/New_York' end)::date)
           on conflict(user_id,signature,market_date) do nothing
           returning id::text`,
          [
            userId, market, trade.assetId, trade.id,
            candidate.title, candidate.body, candidate.route, candidate.signature,
          ],
        );
      } catch (error) {
        // Leave candidate unclaimed so the next poll retries it instead of suppressing it.
        console.error(`[mobile-alerts] failed to insert TRADE_RECOVERY alert for ${trade.ticker}:`, error);
        continue;
      }
      claimed.push(candidate);
      if (!inserted.length) continue;

      browserCreated += 1;
      const receipts = tokens.length ? await sendExpoMessages(tokens, {
        title: candidate.pushTitle,
        body: candidate.pushBody,
        screen: "ledger",
        market,
      }) : [];
      const { sentCount, failedCount } = await recordDisabledTokens(tokens, receipts);
      await workerQuery(
        `insert into public.mobile_notification_log
           (user_id,trade_id,market,recommendation,signature,quote_updated_at,sent_count,failed_count)
         values($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          userId, trade.id, market, candidate.recommendation, candidate.signature,
          trade.recovery?.evaluatedAt ?? trade.quoteUpdatedAt ?? trade.quoteAsOf,
          sentCount, failedCount,
        ],
      );
      expoDelivered += sentCount;
    }

    const nextState = advanceRecoveryAlertState(prevState, claimed);
    if (nextState.stateChanged) {
      await workerQuery(
        `update public.swing_trade_recovery_state
            set last_alerted_recovery_status = $1,
                last_alerted_fresh_setup_key = $2,
                last_alerted_at = now()
          where trade_id = $3::uuid and user_id = $4::uuid`,
        [nextState.lastAlertedRecoveryStatus, nextState.lastAlertedFreshSetupKey, trade.id, userId],
      );
    }
  }
  return { browserCreated, expoDelivered };
}

export async function dispatchMobileTradeAlerts(markets: Array<"IN" | "US">) {
  const tokens = await workerQuery<PushTokenRow>(
    `select id,user_id,expo_push_token from public.mobile_push_tokens where enabled order by user_id,id`,
  );
  const byUser = new Map<string, PushTokenRow[]>();
  for (const token of tokens) byUser.set(token.user_id, [...(byUser.get(token.user_id) ?? []), token]);
  // Candidate evaluation is production monitoring, not a side effect of push
  // registration. Evaluate every account even when it has no enabled device.
  const users = await workerQuery<{ id: string }>(`select id from public.users order by created_at,id`);
  for (const user of users) if (!byUser.has(user.id)) byUser.set(user.id, []);
  let evaluated = 0;
  let alerts = 0;
  let delivered = 0;
  let candidateEvaluated = 0;
  let candidateAlerts = 0;
  let candidateDelivered = 0;
  let recoveryBrowserAlerts = 0;
  let recoveryPushDelivered = 0;
  const runCache = createAlertRunCache();
  for (const [userId, userTokens] of byUser) {
    const preferences = await getMobileAlertPreferences(userId);
    for (const market of markets) {
      const candidateSummary = await dispatchCandidateAlerts(userId, userTokens, market, runCache, preferences);
      candidateEvaluated += candidateSummary.evaluated;
      candidateAlerts += candidateSummary.alerts;
      candidateDelivered += candidateSummary.delivered;
      const newsSummary = await dispatchHighImpactNewsAlerts(userId, userTokens, market, preferences);
      alerts += newsSummary.alerts;
      delivered += newsSummary.delivered;
      const trades = await getSwingTradeLedger(userId, market);
      for (const trade of trades) {
        const signature = tradeAlertSignature(trade);
        if (!signature) continue;
        evaluated += 1;
        const previous = await workerQuery<AlertStateRow>(
          `select last_signature from public.mobile_trade_alert_state where user_id=$1 and trade_id=$2`,
          [userId, trade.id],
        );
        if (!shouldSendTradeAlert(previous[0]?.last_signature ?? null, signature)) continue;
        if (!tradeAlertAllowed(preferences)) {
          // Keep state current while delivery is disabled so re-enabling does not
          // emit a stale risk transition from an earlier scheduler run.
          await workerQuery(
            `insert into public.mobile_trade_alert_state(user_id,trade_id,market,last_signature,last_recommendation,last_sent_at)
             values($1,$2,$3,$4,$5,now())
             on conflict(user_id,trade_id) do update set market=excluded.market,
               last_signature=excluded.last_signature,last_recommendation=excluded.last_recommendation,last_sent_at=now()`,
            [userId, trade.id, market, signature, trade.risk.recommendation],
          );
          continue;
        }
        await workerQuery(
          `insert into public.browser_notification_events
             (user_id,market,kind,asset_id,trade_id,title,body,route,signature,market_date)
           values($1,$2,'TRADE_ACTION',$3,$4,$5,$6,$7,$8,
             (now() at time zone case when $2='IN' then 'Asia/Kolkata' else 'America/New_York' end)::date)
           on conflict(user_id,signature,market_date) do nothing`,
          [userId, market, trade.assetId, trade.id, "InvestoGenie trade alert",
            `${trade.ticker}: ${trade.risk.recommendation.replaceAll("_", " ")}. Open Trade Ledger to review it.`,
            `/terminal/${market.toLowerCase()}/trade-ledger`, signature],
        );
        const receipts = userTokens.length ? await sendExpoMessages(userTokens, {
          title: "InvestoGenie trade alert",
          body: "An open trade status changed. Open Trade Ledger to review the latest server assessment.",
          screen: "ledger", market,
        }) : [];
        const { sentCount, failedCount } = await recordDisabledTokens(userTokens, receipts);
        await workerQuery(
          `insert into public.mobile_trade_alert_state(user_id,trade_id,market,last_signature,last_recommendation,last_sent_at)
           values($1,$2,$3,$4,$5,now())
           on conflict(user_id,trade_id) do update set market=excluded.market,
             last_signature=excluded.last_signature,last_recommendation=excluded.last_recommendation,last_sent_at=now()`,
          [userId, trade.id, market, signature, trade.risk.recommendation],
        );
        await workerQuery(
          `insert into public.mobile_notification_log
             (user_id,trade_id,market,recommendation,signature,quote_updated_at,sent_count,failed_count)
           values($1,$2,$3,$4,$5,$6,$7,$8)`,
          [userId, trade.id, market, trade.risk.recommendation, signature,
            trade.quoteUpdatedAt || trade.quoteAsOf, sentCount, failedCount],
        );
        alerts += 1;
        delivered += sentCount;
      }
      const recoverySummary = await dispatchTradeRecoveryAlerts(userId, userTokens, market, trades, preferences);
      recoveryBrowserAlerts += recoverySummary.browserCreated;
      recoveryPushDelivered += recoverySummary.expoDelivered;
    }
  }
  return {
    users: byUser.size,
    evaluated,
    alerts,
    delivered,
    candidateEvaluated,
    candidateAlerts,
    candidateDelivered,
    recoveryBrowserAlerts,
    recoveryPushDelivered,
  };
}
