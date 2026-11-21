import { createHash } from "node:crypto";
import { tenantQuery, tenantQueryOne } from "@/lib/db";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type StoredMutationResponse = { status: number; body: unknown };

export function mobileIdempotencyKey(request: Request): string {
  const value = request.headers.get("idempotency-key")?.trim() ?? "";
  if (!UUID.test(value)) throw new Error("A valid Idempotency-Key UUID header is required");
  return value;
}

export function mutationRequestHash(operation: string, body: unknown): string {
  return createHash("sha256").update(`${operation}\n${JSON.stringify(body)}`).digest("hex");
}

export async function claimMobileMutation(
  userId: string,
  key: string,
  operation: string,
  requestHash: string,
): Promise<StoredMutationResponse | null> {
  const inserted = await tenantQuery<{ idempotency_key: string }>(userId,
    `insert into public.mobile_mutation_idempotency
       (user_id,idempotency_key,operation,request_hash,status)
     values($1,$2,$3,$4,'PROCESSING')
     on conflict do nothing returning idempotency_key`,
    [userId, key, operation, requestHash],
  );
  if (inserted.length) return null;
  const existing = await tenantQueryOne<{
    operation: string; request_hash: string; status: string;
    response_status: number | null; response_body: unknown;
  }>(userId,
    `select operation,request_hash,status,response_status,response_body
       from public.mobile_mutation_idempotency
      where user_id=$1 and idempotency_key=$2`,
    [userId, key],
  );
  if (!existing || existing.operation !== operation || existing.request_hash !== requestHash) {
    throw new Error("Idempotency key was already used for a different mutation");
  }
  if (existing.status !== "COMPLETED" || existing.response_status === null) {
    throw new Error("This mutation is already being processed");
  }
  return { status: existing.response_status, body: existing.response_body };
}

export async function completeMobileMutation(
  userId: string,
  key: string,
  response: StoredMutationResponse,
): Promise<void> {
  await tenantQuery(userId,
    `update public.mobile_mutation_idempotency
        set status='COMPLETED',response_status=$3,response_body=$4::jsonb,completed_at=now()
      where user_id=$1 and idempotency_key=$2 and status='PROCESSING'`,
    [userId, key, response.status, JSON.stringify(response.body ?? null)],
  );
}

export async function abandonMobileMutation(userId: string, key: string): Promise<void> {
  await tenantQuery(userId,
    `delete from public.mobile_mutation_idempotency
      where user_id=$1 and idempotency_key=$2 and status='PROCESSING'`,
    [userId, key],
  );
}
