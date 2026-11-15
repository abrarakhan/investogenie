import { createHash } from "node:crypto";
import { type NextRequest, NextResponse } from "next/server";

export function mobileEtag(value: unknown): string {
  return `"${createHash("sha256").update(JSON.stringify(value)).digest("base64url")}"`;
}

export function paginateMobileItems<T>(items: T[], rawCursor: string | null, rawLimit: string | null) {
  const requestedLimit = Number(rawLimit ?? 20);
  const limit = Number.isInteger(requestedLimit) ? Math.min(50, Math.max(10, requestedLimit)) : 20;
  const requestedCursor = Number(rawCursor ?? 0);
  const cursor = Number.isInteger(requestedCursor) ? Math.max(0, requestedCursor) : 0;
  const page = items.slice(cursor, cursor + limit);
  return {
    items: page,
    pagination: {
      nextCursor: cursor + page.length < items.length ? String(cursor + page.length) : null,
      total: items.length,
      pageSize: limit,
    },
  };
}

/** Authenticated mobile JSON that may be stored privately and must revalidate before reuse. */
export function mobileJson(
  request: NextRequest,
  payload: unknown,
  etagValue: unknown = payload,
): NextResponse {
  const etag = mobileEtag(etagValue);
  const headers = { ETag: etag, "Cache-Control": "private, no-cache" };
  if (request.headers.get("if-none-match") === etag) {
    return new NextResponse(null, { status: 304, headers });
  }
  return NextResponse.json(payload, { headers });
}
