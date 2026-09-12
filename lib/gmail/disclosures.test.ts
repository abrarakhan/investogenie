import { describe, expect, it } from "vitest";
import {
  buildGmailAuthorizationUrl,
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

  it("ignores unrelated Gmail attachments", () => {
    expect(classifyGmailDocument({ filename: "invoice.pdf", subject: "Your electricity bill" })).toBe("unknown");
  });

  it("extracts a disclosure month and otherwise uses the prior received month", () => {
    expect(inferSnapshotMonth({ filename: "portfolio_August_2026.xlsx" })).toBe("2026-08-01");
    expect(inferSnapshotMonth({ filename: "portfolio.xlsx", receivedAt: "2026-09-10T10:00:00Z" })).toBe("2026-08-01");
  });
});
