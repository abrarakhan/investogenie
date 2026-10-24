import { describe, expect, it } from "vitest";
import { GmailTokenError, isRevokedGrant } from "@/lib/gmail/disclosures";

describe("Gmail token errors", () => {
  it("treats invalid_grant as a revoked or expired grant that needs a reconnect", () => {
    expect(isRevokedGrant(new GmailTokenError("Token has been expired or revoked.", "invalid_grant"))).toBe(true);
  });

  it("does not ask for a reconnect on transient or configuration errors", () => {
    expect(isRevokedGrant(new GmailTokenError("Server error", "server_error"))).toBe(false);
    expect(isRevokedGrant(new GmailTokenError("Bad client", "invalid_client"))).toBe(false);
    expect(isRevokedGrant(new Error("network down"))).toBe(false);
  });
});
