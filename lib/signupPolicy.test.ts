import { describe, expect, it } from "vitest";
import { isOpenSignupEnabled } from "@/lib/signupPolicy";

describe("isOpenSignupEnabled", () => {
  it("is closed unless explicitly enabled", () => {
    expect(isOpenSignupEnabled({} as NodeJS.ProcessEnv)).toBe(false);
    expect(isOpenSignupEnabled({ ALLOW_OPEN_SIGNUP: "1" } as unknown as NodeJS.ProcessEnv)).toBe(false);
    expect(isOpenSignupEnabled({ ALLOW_OPEN_SIGNUP: "TRUE" } as unknown as NodeJS.ProcessEnv)).toBe(false);
    expect(isOpenSignupEnabled({ ALLOW_OPEN_SIGNUP: "true" } as unknown as NodeJS.ProcessEnv)).toBe(true);
  });
});
