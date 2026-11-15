import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { mobileEtag, mobileJson, paginateMobileItems } from "@/lib/mobileHttp";

describe("mobile conditional responses", () => {
  it("creates a stable content validator", () => {
    expect(mobileEtag({ cards: [1, 2] })).toBe(mobileEtag({ cards: [1, 2] }));
    expect(mobileEtag({ cards: [1] })).not.toBe(mobileEtag({ cards: [2] }));
  });

  it("returns 304 when the client already has the representation", () => {
    const payload = { cards: [{ id: "one" }] };
    const etag = mobileEtag(payload);
    const request = new NextRequest("https://example.test/api", { headers: { "If-None-Match": etag } });
    const response = mobileJson(request, payload);
    expect(response.status).toBe(304);
    expect(response.headers.get("etag")).toBe(etag);
    expect(response.headers.get("cache-control")).toBe("private, no-cache");
  });

  it("bounds pages and returns an opaque next cursor", () => {
    const first = paginateMobileItems(Array.from({ length: 45 }, (_, index) => index), null, "20");
    expect(first.items).toHaveLength(20);
    expect(first.pagination).toEqual({ nextCursor: "20", total: 45, pageSize: 20 });
    const last = paginateMobileItems(Array.from({ length: 45 }, (_, index) => index), "40", "500");
    expect(last.items).toEqual([40, 41, 42, 43, 44]);
    expect(last.pagination).toEqual({ nextCursor: null, total: 45, pageSize: 50 });
  });
});
