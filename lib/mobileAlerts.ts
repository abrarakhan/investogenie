import { query } from "@/lib/db";
import { getSwingTradeLedger, type SwingLedgerTrade } from "@/lib/swingTradeLedger";

export function tradeAlertSignature(trade: SwingLedgerTrade): string | null {
  if (trade.status !== "OPEN" || trade.risk.recommendation === "STAY") return null;
  return [trade.risk.recommendation, trade.risk.state, trade.progress.state, ...trade.risk.reasons].join("|");
}

export function shouldSendTradeAlert(previousSignature: string | null, nextSignature: string): boolean {
  return previousSignature !== nextSignature;
}

interface PushTokenRow { id: string; user_id: string; expo_push_token: string }
interface AlertStateRow { last_signature: string }

async function sendGenericExpoMessages(tokens: PushTokenRow[]) {
  if (!tokens.length) return [];
  // Financial details never leave InvestoGenie. The authenticated app fetches them after opening.
  const response = await fetch("https://exp.host/--/api/v2/push/send", {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify(tokens.map((token) => ({
      to: token.expo_push_token,
      sound: "default",
      priority: "high",
      title: "InvestoGenie trade alert",
      body: "An open trade status changed. Open Trade Ledger to review the latest server assessment.",
      data: { screen: "ledger" },
    }))),
  });
  const payload = await response.json().catch(() => ({})) as {
    data?: Array<{ status: string; details?: { error?: string } }>;
  };
  if (!response.ok) throw new Error(`Expo push service failed (${response.status})`);
  return payload.data ?? [];
}

export async function dispatchMobileTradeAlerts(markets: Array<"IN" | "US">) {
  const tokens = await query<PushTokenRow>(
    `select id,user_id,expo_push_token from public.mobile_push_tokens where enabled order by user_id,id`,
  );
  const byUser = new Map<string, PushTokenRow[]>();
  for (const token of tokens) byUser.set(token.user_id, [...(byUser.get(token.user_id) ?? []), token]);
  let evaluated = 0;
  let alerts = 0;
  let delivered = 0;
  for (const [userId, userTokens] of byUser) {
    for (const market of markets) {
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
        const receipts = await sendGenericExpoMessages(userTokens);
        let sentCount = 0;
        let failedCount = 0;
        for (let index = 0; index < receipts.length; index += 1) {
          const receipt = receipts[index];
          if (receipt?.status === "ok") sentCount += 1;
          else {
            failedCount += 1;
            if (receipt?.details?.error === "DeviceNotRegistered") {
              await query(`update public.mobile_push_tokens set enabled=false,updated_at=now() where id=$1`, [userTokens[index].id]);
            }
          }
        }
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
  return { users: byUser.size, evaluated, alerts, delivered };
}
