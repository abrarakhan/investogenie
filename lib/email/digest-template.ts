import type { ScreenRow } from "@/lib/screener";
import type { ProbabilityForecast } from "@/lib/analytics/probability/types";

export interface EmailDigestData {
  userName: string;
  userEmail: string;
  /** Rows from runScreener() — the same source as the Swing Candidates screen. */
  swingCandidates: ScreenRow[];
  /** Rows from getProbabilitySummary() — the same source as the Probability screen. */
  probabilityCandidates: ProbabilityForecast[];
  generatedAt: Date;
}

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

function inr(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "–";
  return `₹${value.toLocaleString("en-IN", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

function pct(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "–";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(digits)}%`;
}

function num(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "–";
  return value.toFixed(digits);
}

/** A metric cell: small grey label above a bold value. */
function metric(label: string, value: string, valueColor = "#1f2937"): string {
  return `
    <div>
      <div style="color: #6b7280; font-size: 11px; text-transform: uppercase; letter-spacing: 0.03em; margin-bottom: 2px;">${label}</div>
      <div style="color: ${valueColor}; font-weight: 600; font-size: 14px;">${value}</div>
    </div>`;
}

/**
 * Swing candidate card — mirrors the Swing Candidates screen: a BUY action,
 * current price, and the derived trade levels (entry / target / stop / trail),
 * R:R, expected days, plus P/E and ROCE.
 */
function swingCard(row: ScreenRow): string {
  const price = row.lastQuote ?? row.close;
  const changePct = row.quoteChangePct;
  const changeColor = changePct != null && changePct >= 0 ? "#10b981" : "#ef4444";
  const dirColor = row.direction === "SHORT" ? "#f97316" : "#10b981";
  const dirLabel = row.direction === "SHORT" ? "SELL" : "BUY";

  return `
    <div style="background: white; border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px; margin-bottom: 12px;">
      <!-- header row -->
      <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 14px;">
        <div>
          <div style="display: flex; align-items: center; gap: 8px;">
            <span style="font-size: 18px; font-weight: 700; color: #1f2937;">${row.ticker}</span>
            <span style="background: ${dirColor}; color: white; font-size: 10px; font-weight: 700; padding: 2px 8px; border-radius: 4px; letter-spacing: 0.05em;">${dirLabel}</span>
          </div>
          <div style="font-size: 12px; color: #9ca3af; margin-top: 2px;">${row.exchange} · ${row.assetClass}</div>
        </div>
        <div style="text-align: right;">
          <div style="font-size: 16px; font-weight: 700; color: #1f2937;">${inr(price)}</div>
          <div style="font-size: 13px; font-weight: 500; color: ${changeColor};">${pct(changePct)}</div>
        </div>
      </div>

      <!-- trade levels -->
      <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; margin-bottom: 12px;">
        ${metric("Entry", inr(row.entry), "#1f2937")}
        ${metric("Target", inr(row.target), "#10b981")}
        ${metric("Stop", inr(row.stopLoss), "#ef4444")}
      </div>

      <!-- stats -->
      <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; padding-top: 12px; border-top: 1px solid #f3f4f6;">
        ${metric("R:R", row.riskReward != null ? `${num(row.riskReward)}×` : "–")}
        ${metric("~Days", row.expectedDays != null ? `${Math.round(row.expectedDays)}d` : "–")}
        ${metric("P/E", num(row.peRatio))}
        ${metric("ROCE", row.roce != null ? `${num(row.roce)}%` : "–")}
        ${metric("Trail", inr(row.trailingStop))}
        ${metric("Score", num(row.score, 0))}
      </div>
    </div>`;
}

/**
 * Probability card — mirrors the Probability screen: 21-trading-day forecast,
 * probability of an up move, expected return, volatility, drawdown risk, and
 * the median (p50) projected price.
 */
function probabilityCard(row: ProbabilityForecast): string {
  const changeColor = row.changePct != null && row.changePct >= 0 ? "#10b981" : "#ef4444";
  const probColor = row.probabilityUpPct >= 50 ? "#10b981" : "#ef4444";
  const erColor = row.expectedReturnPct >= 0 ? "#10b981" : "#ef4444";

  return `
    <div style="background: white; border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px; margin-bottom: 12px;">
      <!-- header row -->
      <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 14px;">
        <div>
          <div style="font-size: 18px; font-weight: 700; color: #1f2937;">${row.ticker}</div>
          <div style="font-size: 12px; color: #9ca3af; margin-top: 2px; max-width: 260px;">${row.name}</div>
        </div>
        <div style="text-align: right;">
          <div style="font-size: 16px; font-weight: 700; color: #1f2937;">${inr(row.lastPrice)}</div>
          <div style="font-size: 13px; font-weight: 500; color: ${changeColor};">${pct(row.changePct)}</div>
        </div>
      </div>

      <!-- probability headline -->
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 12px;">
        ${metric("Prob. Up (21d)", `${num(row.probabilityUpPct)}%`, probColor)}
        ${metric("Expected Return", pct(row.expectedReturnPct), erColor)}
      </div>

      <!-- risk stats -->
      <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; padding-top: 12px; border-top: 1px solid #f3f4f6;">
        ${metric("Volatility", `${num(row.sigma21Pct)}%`)}
        ${metric("Drawdown Risk", `${num(row.drawdownRiskPct)}%`, "#ef4444")}
        ${metric("Median Target", inr(row.priceRange.p50))}
      </div>
    </div>`;
}

export function buildEmailHtml(data: EmailDigestData): string {
  const timestamp = data.generatedAt.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  const swingContent =
    data.swingCandidates.length > 0
      ? data.swingCandidates.map((row) => swingCard(row)).join("")
      : '<p style="color: #6b7280; font-style: italic; text-align: center; padding: 20px;">No swing candidates found today.</p>';

  const probContent =
    data.probabilityCandidates.length > 0
      ? data.probabilityCandidates.map((row) => probabilityCard(row)).join("")
      : '<p style="color: #6b7280; font-style: italic; text-align: center; padding: 20px;">No probability forecasts available today.</p>';

  return `
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>InvestoGenie Daily Digest</title>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            color: #1f2937;
            line-height: 1.6;
            background-color: #f3f4f6;
          }
          a { color: #0ea5e9; text-decoration: none; }
          a:hover { text-decoration: underline; }

          @media only screen and (max-width: 600px) {
            .container { padding: 0 !important; border-radius: 0 !important; }
            .header { padding: 22px 18px !important; }
            .body { padding: 18px !important; }
            h1 { font-size: 22px !important; }
            h2 { font-size: 16px !important; }
            .cta-button { width: 100% !important; display: block !important; box-sizing: border-box; }
          }
        </style>
      </head>
      <body>
        <div class="container" style="max-width: 600px; margin: 0 auto; background-color: white; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">

          <!-- Header -->
          <div class="header" style="background: linear-gradient(135deg, #0ea5e9 0%, #06b6d4 100%); padding: 30px; color: white;">
            <h1 style="font-size: 26px; font-weight: 700; margin-bottom: 8px;">InvestoGenie Daily Digest</h1>
            <p style="opacity: 0.95; font-size: 14px;">Swing candidates & probability forecasts • ${timestamp} IST</p>
          </div>

          <!-- Body -->
          <div class="body" style="padding: 24px;">
            <p style="margin-bottom: 20px; color: #6b7280; font-size: 15px;">
              Hello <strong>${data.userName}</strong>,
            </p>
            <p style="margin-bottom: 28px; color: #6b7280; font-size: 15px;">
              Here are today's top picks from each engine — the same data you see on the Swing Candidates and Probability screens.
            </p>

            <!-- Swing Candidates -->
            <div style="margin-bottom: 36px;">
              <h2 style="font-size: 18px; font-weight: 700; color: #1f2937; margin-bottom: 16px; padding-bottom: 10px; border-bottom: 3px solid #0ea5e9;">
                🎯 Swing Candidates
              </h2>
              ${swingContent}
            </div>

            <!-- Probability -->
            <div style="margin-bottom: 36px;">
              <h2 style="font-size: 18px; font-weight: 700; color: #1f2937; margin-bottom: 16px; padding-bottom: 10px; border-bottom: 3px solid #06b6d4;">
                📊 Probability Forecasts
              </h2>
              ${probContent}
            </div>

            <!-- CTA -->
            <div style="background: linear-gradient(135deg, #f0f9ff 0%, #f0f4ff 100%); padding: 24px; border-radius: 8px; border: 1px solid #e0f2fe; text-align: center; margin-top: 32px;">
              <p style="margin-bottom: 16px; color: #1e40af; font-size: 14px; font-weight: 500;">
                📈 Dive deeper into each stock's analysis
              </p>
              <a href="${APP_URL}/terminal/in/screener" class="cta-button" style="display: inline-block; background-color: #0ea5e9; color: white; padding: 12px 28px; border-radius: 6px; font-weight: 600; font-size: 15px;">
                Open InvestoGenie Terminal
              </a>
            </div>
          </div>

          <!-- Footer -->
          <div style="background-color: #f9fafb; padding: 20px 24px; border-top: 1px solid #e5e7eb; text-align: center;">
            <p style="color: #6b7280; font-size: 12px; margin-bottom: 8px;">
              <a href="${APP_URL}/settings" style="color: #0ea5e9;">Manage email preferences</a> •
              <a href="${APP_URL}/help" style="color: #0ea5e9;">Help</a>
            </p>
            <p style="color: #9ca3af; font-size: 11px;">
              © InvestoGenie • This is not investment advice
            </p>
          </div>
        </div>
      </body>
    </html>
  `;
}
