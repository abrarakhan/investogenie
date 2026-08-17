/** Plain, inline-styled HTML — matches the digest's approach so it renders in any mail client. */
export function passwordResetEmail(resetUrl: string, ttlMinutes: number): string {
  return `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#05070d;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
    <div style="max-width:520px;margin:0 auto;background:#0c1018;border:1px solid #1e2634;border-radius:16px;padding:32px;">
      <div style="font-size:20px;font-weight:800;color:#ffffff;margin-bottom:24px;">
        Investo<span style="color:#22d3ee;">Genie</span>
      </div>
      <h1 style="font-size:18px;color:#ffffff;margin:0 0 12px;">Reset your password</h1>
      <p style="font-size:14px;line-height:1.6;color:#94a3b8;margin:0 0 24px;">
        Use the button below to choose a new password. This link works once and expires in
        ${ttlMinutes} minutes.
      </p>
      <a href="${resetUrl}"
         style="display:inline-block;background:#22d3ee;color:#05070d;font-weight:700;font-size:14px;text-decoration:none;padding:12px 24px;border-radius:10px;">
        Choose a new password
      </a>
      <p style="font-size:12px;line-height:1.6;color:#64748b;margin:24px 0 0;">
        If the button does not work, paste this into your browser:<br>
        <span style="color:#94a3b8;word-break:break-all;">${resetUrl}</span>
      </p>
      <p style="font-size:12px;line-height:1.6;color:#64748b;margin:20px 0 0;border-top:1px solid #1e2634;padding-top:20px;">
        If you did not request this, you can ignore this email — your password stays as it is.
      </p>
    </div>
  </body>
</html>`;
}
