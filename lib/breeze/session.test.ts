import { describe, expect, it } from "vitest";
import { buildBreezeLoginUrl, extractBreezeApiSession } from "./session";

describe("Breeze mobile session handoff", () => {
  it("encodes special characters in the API key", () => {
    const url = new URL(buildBreezeLoginUrl("abc+=&123"));
    expect(url.origin + url.pathname).toBe("https://api.icicidirect.com/apiuser/login");
    expect(url.searchParams.get("api_key")).toBe("abc+=&123");
  });

  it.each(["apisession", "API_Session", "api_session", "session_token"])(
    "accepts the %s callback field",
    (key) => {
      expect(extractBreezeApiSession(new URLSearchParams({ [key]: " 12345678 " })))
        .toBe("12345678");
    },
  );

  it("rejects missing and implausibly large callback values", () => {
    expect(extractBreezeApiSession(new URLSearchParams())).toBeNull();
    expect(extractBreezeApiSession(new URLSearchParams({ apisession: "x".repeat(4097) }))).toBeNull();
  });
});
