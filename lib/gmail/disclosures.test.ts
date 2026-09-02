import { describe, expect, it } from "vitest";
import {
  buildGmailAuthorizationUrl,
  GMAIL_READONLY_SCOPE,
  hashOAuthState,
} from "@/lib/gmail/disclosures";

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
