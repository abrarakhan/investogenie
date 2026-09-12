import { describe, expect, it } from "vitest";
import {
  buildGmailAuthorizationUrl,
  extractDisclosureDownloadUrl,
  GMAIL_READONLY_SCOPE,
  hashOAuthState,
} from "@/lib/gmail/disclosures";
import { classifyGmailDocument, inferSnapshotMonth } from "@/lib/gmail/classification";

describe("Gmail disclosure OAuth", () => {
  it("requests only read-only Gmail access with an offline grant", () => {
    const url = new URL(buildGmailAuthorizationUrl(
      "client-id",
      "https://investogenie.example/api/gmail/callback",
      "state-value",
    ));
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("scope")).toBe(GMAIL_READONLY_SCOPE);
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("state")).toBe("state-value");
  });

  it("stores a one-way hash instead of the OAuth state value", () => {
    expect(hashOAuthState("state-value")).not.toBe("state-value");
    expect(hashOAuthState("state-value")).toBe(hashOAuthState("state-value"));
  });
});

describe("Gmail investment document classification", () => {
  it("recognizes an NSDL consolidated account statement PDF", () => {
    expect(classifyGmailDocument({
      filename: "NSDL-eCAS_2026.pdf",
      subject: "Your Consolidated Account Statement",
      sender: "NSDL e-CAS <ecas@nsdl.co.in>",
    })).toBe("nsdl_cas");
  });

  it("recognizes an AMC monthly portfolio workbook", () => {
    expect(classifyGmailDocument({
      filename: "HDFC_Monthly_Portfolio_August_2026.xlsx",
      subject: "Monthly portfolio disclosure",
    })).toBe("amc_disclosure");
  });

  it("recognizes a generically named AMC workbook from its sender", () => {
    expect(classifyGmailDocument({
      filename: "Monthly_Portfolio_2026_08.xlsm",
      subject: "Your latest statutory document",
      sender: "HDFC Mutual Fund <statutory@hdfcfund.com>",
    })).toBe("amc_disclosure");
  });

  it("ignores unrelated Gmail attachments", () => {
    expect(classifyGmailDocument({ filename: "invoice.pdf", subject: "Your electricity bill" })).toBe("unknown");
  });

  it("extracts a disclosure month and otherwise uses the prior received month", () => {
    expect(inferSnapshotMonth({ filename: "portfolio_August_2026.xlsx" })).toBe("2026-08-01");
    expect(inferSnapshotMonth({ filename: "portfolio.xlsx", receivedAt: "2026-09-10T10:00:00Z" })).toBe("2026-08-01");
  });
});

describe("Gmail disclosure links", () => {
  it("prefers a direct trusted workbook over decorative links", () => {
    const html = `<a href="https://www.sbimf.com/logo.png">Logo</a>
      <a href="https://www.sbimf.com/docs/portfolio-august-2026.xlsx">Portfolio</a>`;
    expect(extractDisclosureDownloadUrl(html)).toBe("https://www.sbimf.com/docs/portfolio-august-2026.xlsx");
  });

  it("extracts the trusted workbook nested in a mail tracker", () => {
    const html = `<a href="http://mailer.quant.in/path/~https://quantmutual.com/Admin/disclouser/quant_Infrastructure_31_Aug_2026.xlsx">Download</a>`;
    expect(extractDisclosureDownloadUrl(html)).toBe("https://quantmutual.com/Admin/disclouser/quant_Infrastructure_31_Aug_2026.xlsx");
  });

  it("extracts an encoded trusted workbook from a download landing page", () => {
    const html = `window.location = &quot;https://www.sbimf.com/docs/portfolio-august-2026.xlsx?x=1&amp;y=2&quot;`;
    expect(extractDisclosureDownloadUrl(html)).toBe("https://www.sbimf.com/docs/portfolio-august-2026.xlsx?x=1&y=2");
  });

  it("rejects untrusted and local download targets", () => {
    expect(extractDisclosureDownloadUrl('<a href="http://127.0.0.1/private.xlsx">Download</a>')).toBeNull();
    expect(extractDisclosureDownloadUrl('<a href="https://evil.example/portfolio.xlsx">Download</a>')).toBeNull();
  });
});
