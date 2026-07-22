"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { query, tx } from "@/lib/db";
import { getFundMappingData, countSnapshotStocks } from "@/lib/funds/fundMappingStore";

async function requireUser() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return user;
}

async function ensureHolding(userId: string, holdingId: string) {
  const rows = await query<{ id: string }>(
    `select h.id
       from public.holdings h
       join public.assets a on a.id = h.asset_id
      where h.id = $1 and h.user_id = $2 and a.asset_class = 'MUTUAL_FUND'`,
    [holdingId, userId],
  );
  if (!rows[0]) throw new Error("Fund holding not found");
}

export async function acceptFundSuggestion(formData: FormData) {
  const user = await requireUser();
  const holdingId = String(formData.get("holdingId") ?? "");
  const schemeCode = String(formData.get("schemeCode") ?? "");
  const method = String(formData.get("method") ?? "manual");
  const confidence = Number(formData.get("confidence") ?? 1);
  if (!holdingId || !schemeCode) throw new Error("Missing mapping target");
  await ensureHolding(user.id, holdingId);
  await query(
    `insert into public.user_fund_mappings (user_id, user_holding_id, scheme_code, status, match_method, confidence, matched_at, matched_by, updated_at)
     values ($1, $2, $3, 'matched', $4, $5, now(), $1, now())
     on conflict (user_id, user_holding_id) do update set
       scheme_code = excluded.scheme_code,
       status = 'matched',
       match_method = excluded.match_method,
       confidence = excluded.confidence,
       matched_at = now(),
       matched_by = excluded.matched_by,
       rejected_at = null,
       updated_at = now()`,
    [user.id, holdingId, schemeCode, method, Number.isFinite(confidence) ? confidence : 1],
  );
  const stocks = await countSnapshotStocks(schemeCode);
  revalidatePath("/portfolio/fund-mapping");
  revalidatePath("/terminal/in");
  redirect(`/portfolio/fund-mapping?linked=${stocks}`);
}

export async function rejectFundSuggestion(formData: FormData) {
  const user = await requireUser();
  const holdingId = String(formData.get("holdingId") ?? "");
  const schemeCode = String(formData.get("schemeCode") || "") || null;
  if (!holdingId) throw new Error("Missing fund holding");
  await ensureHolding(user.id, holdingId);
  await query(
    `insert into public.user_fund_mappings (user_id, user_holding_id, scheme_code, status, match_method, rejected_at, updated_at)
     values ($1, $2, $3, 'rejected', 'user_rejected', now(), now())
     on conflict (user_id, user_holding_id) do update set
       scheme_code = excluded.scheme_code,
       status = 'rejected',
       match_method = 'user_rejected',
       confidence = null,
       matched_at = null,
       matched_by = null,
       rejected_at = now(),
       updated_at = now()`,
    [user.id, holdingId, schemeCode],
  );
  revalidatePath("/portfolio/fund-mapping");
  revalidatePath("/terminal/in");
}

export async function unlinkFundMapping(formData: FormData) {
  const user = await requireUser();
  const holdingId = String(formData.get("holdingId") ?? "");
  if (!holdingId) throw new Error("Missing fund holding");
  await query("delete from public.user_fund_mappings where user_id = $1 and user_holding_id = $2", [user.id, holdingId]);
  revalidatePath("/portfolio/fund-mapping");
  revalidatePath("/terminal/in");
}

export async function autoAcceptIsinMatches() {
  const user = await requireUser();
  const data = await getFundMappingData(user.id);
  const matches = data.funds.filter((fund) => fund.suggestion.method === "isin_exact" && fund.suggestion.schemeCode && fund.displayStatus !== "matched");
  if (matches.length === 0) return;

  await tx(async (client) => {
    for (const fund of matches) {
      await client.query(
        `insert into public.user_fund_mappings (user_id, user_holding_id, scheme_code, status, match_method, confidence, matched_at, matched_by, updated_at)
         values ($1, $2, $3, 'matched', 'isin_exact', 1.0000, now(), $1, now())
         on conflict (user_id, user_holding_id) do update set
           scheme_code = excluded.scheme_code,
           status = 'matched',
           match_method = 'isin_exact',
           confidence = 1.0000,
           matched_at = now(),
           matched_by = excluded.matched_by,
           rejected_at = null,
           updated_at = now()`,
        [user.id, fund.holdingId, fund.suggestion.schemeCode],
      );
    }
  });
  revalidatePath("/portfolio/fund-mapping");
  revalidatePath("/terminal/in");
}
