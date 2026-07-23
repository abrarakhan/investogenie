import type { ScreenerStock } from "@/lib/screener/service";

export interface EmailDigestData {
  userName: string;
  userEmail: string;
  swingCandidates: ScreenerStock[];
  probabilityCandidates: ScreenerStock[];
  generatedAt: Date;
}

function formatCandidateCard(stock: ScreenerStock, index: number): string {
  const pe = stock.pe_ratio ? stock.pe_ratio.toFixed(1) : "–";
  const roe = stock.roe ? stock.roe.toFixed(1) : "–";
  const roce = stock.roce ? stock.roce.toFixed(1) : "–";
  const price = stock.ltp ? `₹${stock.ltp.toFixed(0)}` : "–";
  const pctChange = stock.change_pct_1d
    ? `${stock.change_pct_1d > 0 ? "+" : ""}${stock.change_pct_1d.toFixed(1)}%`
    : "–";
  const pctChangeColor = stock.change_pct_1d && stock.change_pct_1d > 0 ? "#10b981" : "#ef4444";

  return `
    <div style="background: white; border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px; margin-bottom: 12px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
      <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 12px;">
        <div>
          <div style="font-size: 18px; font-weight: 700; color: #1f2937; margin-bottom: 4px;">${stock.symbol}</div>
          <div style="font-size: 12px; color: #6b7280; line-height: 1.4;">${stock.name || "–"}</div>
        </div>
        <div style="text-align: right;">
          <div style="font-size: 16px; font-weight: 600; color: #1f2937;">${price}</div>
          <div style="font-size: 13px; color: ${pctChangeColor}; font-weight: 500;">${pctChange}</div>
        </div>
      </div>

      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; font-size: 13px;">
        <div>
          <div style="color: #6b7280; margin-bottom: 2px;">P/E Ratio</div>
          <div style="color: #1f2937; font-weight: 600;">${pe}</div>
        </div>
        <div>
          <div style="color: #6b7280; margin-bottom: 2px;">ROE</div>
          <div style="color: #1f2937; font-weight: 600;">${roe}%</div>
        </div>
        <div>
          <div style="color: #6b7280; margin-bottom: 2px;">ROCE</div>
          <div style="color: #1f2937; font-weight: 600;">${roce}%</div>
        </div>
        <div>
          <div style="color: #6b7280; margin-bottom: 2px;">Sector</div>
          <div style="color: #1f2937; font-weight: 600;">${stock.sector || "–"}</div>
        </div>
      </div>
    </div>
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

  const swingContent =
    data.swingCandidates.length > 0
      ? data.swingCandidates.map((stock, i) => formatCandidateCard(stock, i)).join("")
      : '<p style="color: #6b7280; font-style: italic; text-align: center; padding: 20px;">No swing candidates found today.</p>';

  const probContent =
    data.probabilityCandidates.length > 0
      ? data.probabilityCandidates.map((stock, i) => formatCandidateCard(stock, i)).join("")
      : '<p style="color: #6b7280; font-style: italic; text-align: center; padding: 20px;">No probability candidates found today.</p>';

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

          /* Mobile responsive */
          @media only screen and (max-width: 600px) {
            .container { padding: 16px !important; }
            .header { padding: 20px 16px !important; }
            .body { padding: 16px !important; }
            h1 { font-size: 22px !important; }
            h2 { font-size: 16px !important; }
            .cta-button { width: 100% !important; display: block !important; padding: 12px 16px !important; }
          }
        </style>
      </head>
      <body>
        <div class="container" style="max-width: 600px; margin: 0 auto; background-color: white; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">

          <!-- Header -->
          <div class="header" style="background: linear-gradient(135deg, #0ea5e9 0%, #06b6d4 100%); padding: 30px; color: white;">
            <h1 style="font-size: 26px; font-weight: 700; margin-bottom: 8px;">InvestoGenie Daily Digest</h1>
            <p style="opacity: 0.95; font-size: 14px;">Top swing and probability candidates • ${timestamp} IST</p>
          </div>

          <!-- Body -->
          <div class="body" style="padding: 24px;">
            <p style="margin-bottom: 20px; color: #6b7280; font-size: 15px;">
              Hello <strong>${data.userName}</strong>,
            </p>
            <p style="margin-bottom: 28px; color: #6b7280; font-size: 15px; line-height: 1.6;">
              Here are your top 5 candidates from today's market screening. Click any stock to view detailed analysis in InvestoGenie.
            </p>

            <!-- Swing Candidates Section -->
            <div style="margin-bottom: 36px;">
              <h2 style="font-size: 18px; font-weight: 700; color: #1f2937; margin-bottom: 16px; padding-bottom: 10px; border-bottom: 3px solid #0ea5e9;">
                🎯 Swing Candidates
              </h2>
              <div style="margin-top: 12px;">
                ${swingContent}
              </div>
            </div>

            <!-- Probability Section -->
            <div style="margin-bottom: 36px;">
              <h2 style="font-size: 18px; font-weight: 700; color: #1f2937; margin-bottom: 16px; padding-bottom: 10px; border-bottom: 3px solid #06b6d4;">
                📊 Probability Screen
              </h2>
              <div style="margin-top: 12px;">
                ${probContent}
              </div>
            </div>

            <!-- CTA Section -->
            <div style="background: linear-gradient(135deg, #f0f9ff 0%, #f0f4ff 100%); padding: 24px; border-radius: 8px; border: 1px solid #e0f2fe; text-align: center; margin-top: 32px;">
              <p style="margin-bottom: 16px; color: #1e40af; font-size: 14px; font-weight: 500;">
                📈 Dive deeper into each stock's analysis
              </p>
              <a href="${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/terminal/in/screener" class="cta-button" style="display: inline-block; background-color: #0ea5e9; color: white; padding: 12px 28px; border-radius: 6px; font-weight: 600; font-size: 15px; cursor: pointer;">
                Open InvestoGenie Terminal
              </a>
            </div>
          </div>

          <!-- Footer -->
          <div style="background-color: #f9fafb; padding: 20px 24px; border-top: 1px solid #e5e7eb; text-align: center;">
            <p style="color: #6b7280; font-size: 12px; margin-bottom: 8px;">
              <a href="${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/settings" style="color: #0ea5e9;">Manage email preferences</a> •
              <a href="${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/help" style="color: #0ea5e9;">Help</a>
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
