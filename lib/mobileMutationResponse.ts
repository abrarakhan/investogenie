import { NextResponse } from "next/server";
import {
  abandonMobileMutation, claimMobileMutation, completeMobileMutation,
  mobileIdempotencyKey, mutationRequestHash,
} from "@/lib/mobileMutationIdempotency";

export async function runIdempotentMobileMutation(
  request: Request,
  userId: string,
  operation: string,
  body: unknown,
  execute: () => Promise<{ status?: number; body?: unknown }>,
): Promise<NextResponse> {
  let key: string;
  try {
    key = mobileIdempotencyKey(request);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid idempotency key" }, { status: 400 });
  }
  const hash = mutationRequestHash(operation, body);
  try {
    const replay = await claimMobileMutation(userId, key, operation, hash);
    if (replay) return NextResponse.json(replay.body, { status: replay.status });
    try {
      const result = await execute();
      const response = { status: result.status ?? 200, body: result.body ?? { ok: true } };
      await completeMobileMutation(userId, key, response);
      return NextResponse.json(response.body, { status: response.status });
    } catch (error) {
      await abandonMobileMutation(userId, key).catch(() => undefined);
      throw error;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Mutation could not be completed";
    const status = message.includes("already being processed") ? 409 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
