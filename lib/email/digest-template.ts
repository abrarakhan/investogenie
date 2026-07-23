import type { ScreenerStock } from "@/lib/screener/service";

export interface EmailDigestData {
  userName: string;
  userEmail: string;
  swingCandidates: ScreenerStock[];
  probabilityCandidates: ScreenerStock[];
  generatedAt: Date;
}

function formatCandidateRow(stock: ScreenerStock, index: number): string {
  const pe = stock.pe_ratio ? stock.pe_ratio.toFixed(1) : "–";
  const roe = stock.roe ? stock.roe.toFixed(1) : "–";
  const roce = stock.roce ? stock.roce.toFixed(1) : "–";
  const mcap = stock.market_cap ? `₹${(stock.market_cap / 10000).toFixed(0)}Cr` : "–";
  const price = stock.ltp ? `₹${stock.ltp.toFixed(0)}` : "–";
  const pctChange = stock.change_pct_1d
    ? `${stock.change_pct_1d > 0 ? "+" : ""}${stock.change_pct_1d.toFixed(1)}%`
    : "–";

  return `
    <tr style="background-color: ${index % 2 === 0 ? "#f9fafb" : "white"}; border-bottom: 1px solid #e5e7eb;">
      <td style="padding: 12px; color: #1f2937; font-weight: 500;">${index + 1}</td>
      <td style="padding: 12px; color: #1f2937; font-weight: 600;">${stock.symbol}</td>
      <td style="padding: 12px; color: #6b7280;">${stock.name || "–"}</td>
      <td style="padding: 12px; text-align: right; color: #1f2937;">${price}</td>
      <td style="padding: 12px; text-align: right; color: #6b7280;">${pctChange}</td>
      <td style="padding: 12px; text-align: right; color: #6b7280;">${pe}</td>
      <td style="padding: 12px; text-align: right; color: #6b7280;">${roe}%</td>
      <td style="padding: 12px; text-align: right; color: #6b7280;">${roce}%</td>
      <td style="padding: 12px; text-align: right; color: #6b7280;">${stock.sector || "–"}</td>
    </tr>
  `;
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

  const swingTable =
    data.swingCandidates.length > 0
      ? `
      <table style="width: 100%; border-collapse: collapse; margin-top: 12px;">
        <thead>
          <tr style="background-color: #111827; color: white;">
            <th style="padding: 12px; text-align: left;">#</th>
            <th style="padding: 12px; text-align: left;">Symbol</th>
            <th style="padding: 12px; text-align: left;">Company</th>
            <th style="padding: 12px; text-align: right;">Price</th>
            <th style="padding: 12px; text-align: right;">5D %</th>
            <th style="padding: 12px; text-align: right;">P/E</th>
            <th style="padding: 12px; text-align: right;">ROE</th>
            <th style="padding: 12px; text-align: right;">ROCE</th>
            <th style="padding: 12px; text-align: right;">Sector</th>
          </tr>
        </thead>
        <tbody>
          ${data.swingCandidates.map((stock, i) => formatCandidateRow(stock, i)).join("")}
        </tbody>
      </table>
    `
      : '<p style="color: #6b7280; font-style: italic;">No swing candidates found today.</p>';

  const probTable =
    data.probabilityCandidates.length > 0
      ? `
      <table style="width: 100%; border-collapse: collapse; margin-top: 12px;">
        <thead>
          <tr style="background-color: #111827; color: white;">
            <th style="padding: 12px; text-align: left;">#</th>
            <th style="padding: 12px; text-align: left;">Symbol</th>
            <th style="padding: 12px; text-align: left;">Company</th>
            <th style="padding: 12px; text-align: right;">Price</th>
            <th style="padding: 12px; text-align: right;">5D %</th>
            <th style="padding: 12px; text-align: right;">P/E</th>
            <th style="padding: 12px; text-align: right;">ROE</th>
            <th style="padding: 12px; text-align: right;">ROCE</th>
            <th style="padding: 12px; text-align: right;">Sector</th>
          </tr>
        </thead>
        <tbody>
          ${data.probabilityCandidates.map((stock, i) => formatCandidateRow(stock, i)).join("")}
        </tbody>
      </table>
    `
      : '<p style="color: #6b7280; font-style: italic;">No probability candidates found today.</p>';

  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8" />
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #1f2937; line-height: 1.5; }
          a { color: #0ea5e9; text-decoration: none; }
          a:hover { text-decoration: underline; }
        </style>
      </head>
      <body style="background-color: #f3f4f6; padding: 20px;">
        <div style="max-width: 900px; margin: 0 auto; background-color: white; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
          <!-- Header -->
          <div style="background: linear-gradient(135deg, #0ea5e9 0%, #06b6d4 100%); padding: 30px; color: white;">
            <h1 style="margin: 0; font-size: 28px;">InvestoGenie Daily Digest</h1>
            <p style="margin: 8px 0 0 0; opacity: 0.9; font-size: 14px;">Top swing and probability candidates</p>
          </div>

          <!-- Body -->
          <div style="padding: 30px;">
            <p style="margin: 0 0 20px 0; color: #6b7280;">
              Hello <strong>${data.userName}</strong>,
            </p>
            <p style="margin: 0 0 20px 0; color: #6b7280;">
              Here are your top 5 candidates from today's screening, generated at <strong>${timestamp}</strong> IST.
            </p>

            <!-- Swing Candidates Section -->
            <div style="margin-bottom: 40px;">
              <h2 style="margin: 0 0 12px 0; font-size: 18px; color: #1f2937; border-bottom: 2px solid #0ea5e9; padding-bottom: 8px;">
                🎯 Swing Candidates
              </h2>
              ${swingTable}
            </div>

            <!-- Probability Section -->
            <div style="margin-bottom: 30px;">
              <h2 style="margin: 0 0 12px 0; font-size: 18px; color: #1f2937; border-bottom: 2px solid #06b6d4; padding-bottom: 8px;">
                📊 Probability Screen
              </h2>
              ${probTable}
            </div>

            <!-- Footer CTA -->
            <div style="background-color: #f9fafb; padding: 20px; border-radius: 6px; margin-top: 30px; text-align: center;">
              <p style="margin: 0; color: #6b7280; font-size: 14px;">
                View full details and manage your portfolio:
              </p>
              <a href="${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/terminal/in/screener" style="display: inline-block; margin-top: 12px; background-color: #0ea5e9; color: white; padding: 10px 20px; border-radius: 6px; font-weight: 500;">
                Open InvestoGenie
              </a>
            </div>
          </div>

          <!-- Footer -->
          <div style="background-color: #f3f4f6; padding: 20px; text-align: center; border-top: 1px solid #e5e7eb;">
            <p style="margin: 0; color: #9ca3af; font-size: 12px;">
              You can manage your email preferences in <a href="${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/settings">Settings</a>.
            </p>
            <p style="margin: 8px 0 0 0; color: #9ca3af; font-size: 12px;">
              © InvestoGenie. This is not financial advice.
            </p>
          </div>
        </div>
      </body>
    </html>
  `;
}
