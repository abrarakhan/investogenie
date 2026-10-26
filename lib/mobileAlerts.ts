import { query } from "@/lib/db";
import { getMomentumIgnitionCandidates } from "@/lib/momentumIgnition";
import { getMomentumIgnitionCandidates as getLegacyMomentumIgnitionCandidates } from "@/lib/momentumIgnitionLegacy";
import { getUserSwingSettings } from "@/lib/settings";
import { getStrongSwingCandidates } from "@/lib/strongSwing";
import { getSwingTradeLedger, type SwingLedgerTrade } from "@/lib/swingTradeLedger";
import { markLiveMarketTargets } from "@/lib/liveMarketTargets";

export function tradeAlertSignature(trade: SwingLedgerTrade): string | null {
  if (trade.status !== "OPEN" || trade.risk.recommendation === "STAY") return null;
  return [trade.risk.recommendation, trade.risk.state, trade.progress.state, ...trade.risk.reasons].join("|");
}

export function shouldSendTradeAlert(previousSignature: string | null, nextSignature: string): boolean {
  return previousSignature !== nextSignature;
}

interface PushTokenRow { id: string; user_id: string; expo_push_token: string }
interface AlertStateRow { last_signature: string }
interface CandidateAlertStateRow { was_ready: boolean; last_status: string }
type CandidateEngine = "STRONG_SWING" | "MOMENTUM_IGNITION" | "MOMENTUM_IGNITION_V2";
interface CandidateSignal {
  assetId: string;
  ticker: string;
  engine: CandidateEngine;
  status: string;
  ready: boolean;
  quoteAsOf: string | null;
}

async function sendExpoMessages(tokens: PushTokenRow[], message: {
  title: string; body: string; screen: "ledger" | "strong-swing"; market?: "IN" | "US";
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
        await query(`update public.mobile_push_tokens set enabled=false,updated_at=now() where id=$1`, [tokens[index].id]);
      }
    }
  }
  return { sentCount, failedCount };
}

async function candidateSignals(market: "IN" | "US", userId: string): Promise<CandidateSignal[]> {
  const settings = await getUserSwingSettings(userId);
  const [strong, legacy, v2] = await Promise.all([
    getStrongSwingCandidates(market, settings),
    getLegacyMomentumIgnitionCandidates(market, settings),
    getMomentumIgnitionCandidates(market, settings),
  ]);
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
  ];
  await markLiveMarketTargets(signals.map((candidate) => candidate.assetId), "strong_swing");
  return signals;
}

async function dispatchCandidateAlerts(userId: string, tokens: PushTokenRow[], market: "IN" | "US") {
  const candidates = await candidateSignals(market, userId);
  const readyByEngine = new Map<CandidateEngine, string[]>();
  for (const engine of ["STRONG_SWING", "MOMENTUM_IGNITION", "MOMENTUM_IGNITION_V2"] as const) {
    readyByEngine.set(engine, candidates.filter((candidate) => candidate.engine === engine && candidate.ready).map((candidate) => candidate.assetId));
    await query(
      `update public.mobile_candidate_alert_state set was_ready=false,last_seen_at=now()
        where user_id=$1 and market=$2 and engine=$3
          and not (asset_id = any($4::uuid[]))`,
      [userId, market, engine, readyByEngine.get(engine)],
    );
  }
  let alerts = 0;
  let delivered = 0;
  for (const candidate of candidates) {
    const previous = await query<CandidateAlertStateRow>(
      `select was_ready,last_status from public.mobile_candidate_alert_state
        where user_id=$1 and market=$2 and engine=$3 and asset_id=$4`,
      [userId, market, candidate.engine, candidate.assetId],
    );
    const transitioned = candidate.ready && previous[0]?.was_ready !== true;
    const statusChanged = previous[0]?.last_status !== candidate.status
      || previous[0]?.was_ready !== candidate.ready;
    let sentCount = 0;
    let failedCount = 0;
    if (transitioned) {
      const engineLabel = candidate.engine === "STRONG_SWING" ? "Strong Swing"
        : candidate.engine === "MOMENTUM_IGNITION" ? "Momentum Ignition" : "Momentum Ignition V2";
      const statusLabel = candidate.status === "EXECUTION_READY" ? "Execution Ready" : "Momentum Ready";
      const receipts = await sendExpoMessages(tokens, {
        title: `InvestoGenie: ${statusLabel}`,
        body: `${candidate.ticker} entered ${statusLabel} in ${engineLabel}. Open Strong Swing to review it.`,
        screen: "strong-swing", market,
      });
      ({ sentCount, failedCount } = await recordDisabledTokens(tokens, receipts));
      alerts += 1;
      delivered += sentCount;
      await query(
        `insert into public.mobile_notification_log
           (user_id,asset_id,engine,market,recommendation,signature,quote_updated_at,sent_count,failed_count)
         values($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [userId, candidate.assetId, candidate.engine, market, candidate.status,
          `${candidate.engine}|${candidate.status}`, candidate.quoteAsOf, sentCount, failedCount],
      );
    }
    if (statusChanged) {
      await query(
        `insert into public.candidate_signal_observations
           (user_id,market,engine,asset_id,status,ready,quote_as_of)
         values($1,$2,$3,$4,$5,$6,$7)`,
        [userId, market, candidate.engine, candidate.assetId, candidate.status,
          candidate.ready, candidate.quoteAsOf],
      );
    }
    await query(
      `insert into public.mobile_candidate_alert_state
         (user_id,market,engine,asset_id,last_status,was_ready,last_seen_at,last_sent_at)
         values($1,$2,$3,$4,$5,$6,now(),case when $7 then now() else null end)
       on conflict(user_id,market,engine,asset_id) do update set
         last_status=excluded.last_status,was_ready=excluded.was_ready,last_seen_at=now(),
         last_sent_at=case when $7 then now() else mobile_candidate_alert_state.last_sent_at end`,
      [userId, market, candidate.engine, candidate.assetId, candidate.status, candidate.ready, transitioned],
    );
  }
  return { evaluated: candidates.length, alerts, delivered };
}

export async function dispatchMobileTradeAlerts(markets: Array<"IN" | "US">) {
  const tokens = await query<PushTokenRow>(
    `select id,user_id,expo_push_token from public.mobile_push_tokens where enabled order by user_id,id`,
  );
  const byUser = new Map<string, PushTokenRow[]>();
  for (const token of tokens) byUser.set(token.user_id, [...(byUser.get(token.user_id) ?? []), token]);
  // Candidate evaluation is production monitoring, not a side effect of push
  // registration. Evaluate every account even when it has no enabled device.
  const users = await query<{ id: string }>(`select id from public.users order by created_at,id`);
  for (const user of users) if (!byUser.has(user.id)) byUser.set(user.id, []);
  let evaluated = 0;
  let alerts = 0;
  let delivered = 0;
  let candidateEvaluated = 0;
  let candidateAlerts = 0;
  let candidateDelivered = 0;
  for (const [userId, userTokens] of byUser) {
    for (const market of markets) {
      const candidateSummary = await dispatchCandidateAlerts(userId, userTokens, market);
      candidateEvaluated += candidateSummary.evaluated;
      candidateAlerts += candidateSummary.alerts;
      candidateDelivered += candidateSummary.delivered;
      if (!userTokens.length) continue;
      const trades = await getSwingTradeLedger(userId, market);
      for (const trade of trades) {
        const signature = tradeAlertSignature(trade);
        if (!signature) continue;
        evaluated += 1;
        const previous = await query<AlertStateRow>(
          `select last_signature from public.mobile_trade_alert_state where user_id=$1 and trade_id=$2`,
          [userId, trade.id],
        );
        if (!shouldSendTradeAlert(previous[0]?.last_signature ?? null, signature)) continue;
        const receipts = await sendExpoMessages(userTokens, {
          title: "InvestoGenie trade alert",
          body: "An open trade status changed. Open Trade Ledger to review the latest server assessment.",
          screen: "ledger", market,
        });
        const { sentCount, failedCount } = await recordDisabledTokens(userTokens, receipts);
        await query(
          `insert into public.mobile_trade_alert_state(user_id,trade_id,market,last_signature,last_recommendation,last_sent_at)
           values($1,$2,$3,$4,$5,now())
           on conflict(user_id,trade_id) do update set market=excluded.market,
             last_signature=excluded.last_signature,last_recommendation=excluded.last_recommendation,last_sent_at=now()`,
          [userId, trade.id, market, signature, trade.risk.recommendation],
        );
        await query(
          `insert into public.mobile_notification_log
             (user_id,trade_id,market,recommendation,signature,quote_updated_at,sent_count,failed_count)
           values($1,$2,$3,$4,$5,$6,$7,$8)`,
          [userId, trade.id, market, trade.risk.recommendation, signature,
            trade.quoteUpdatedAt || trade.quoteAsOf, sentCount, failedCount],
        );
        alerts += 1;
        delivered += sentCount;
      }
    }
  }
  return { users: byUser.size, evaluated, alerts, delivered, candidateEvaluated, candidateAlerts, candidateDelivered };
}
