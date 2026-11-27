import { query } from "@/lib/db";
import { isMarketOpenNow } from "@/lib/market-calendar.mjs";
import type { MarketId } from "@/lib/types";
import type {
  SectorThrustGroupLevel,
  SectorThrustGroupStatus,
  SectorThrustGroupView,
  SectorThrustMemberRole,
  SectorThrustMemberView,
  SectorThrustNewsItem,
  SectorThrustRunStatus,
  SectorThrustSnapshot,
} from "@/lib/sectorThrustTypes";

export type {
  SectorThrustGroupLevel,
  SectorThrustGroupStatus,
  SectorThrustGroupView,
  SectorThrustMemberRole,
  SectorThrustMemberView,
  SectorThrustNewsItem,
  SectorThrustRunStatus,
  SectorThrustSnapshot,
};

const LIVE_STALE_AFTER_MS = 10 * 60 * 1000;

interface RunRow {
  id: string | number;
  session_date: string;
  checkpoint_at: string | Date;
  mode: string;
  rule_version: string;
  taxonomy_version: string;
  curve_version: string | null;
  status: string;
  unverified_reason: string | null;
  eligible_universe_count: number;
  unclassified_count: number;
  scan_duration_ms: number;
}

interface GroupRow {
  id: string | number;
  group_level: string;
  group_key: string;
  group_label: string;
  parent_sector: string | null;
  status: string;
  unverified_reason: string | null;
  eligible_count: number;
  price_fresh_count: number;
  volume_fresh_count: number;
  qualifying_count: number;
  median_return_pct: string | number | null;
  median_rvol: string | number | null;
  volume_confirmation_route: string | null;
  first_triggered_at: string | Date | null;
  related_news: unknown;
}

interface MemberRow {
  group_id: string | number;
  asset_id: string;
  ticker: string;
  name: string | null;
  role: string;
  price: string | number;
  return_pct: string | number;
  rvol: string | number | null;
  avg_traded_value_20d: string | number | null;
  atr_pct: string | number | null;
  atr_extension: string | number | null;
  first_seen_at: string | Date;
  reason: string;
  reference_entry: string | number | null;
  invalidation_stop: string | number | null;
  target_zone: string | number | null;
}

function toNum(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toIsoTs(v: string | Date | null | undefined): string | null {
  if (!v) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString();
  return String(v);
}

export function isSectorThrustRunStale(
  checkpointAtIso: string | null,
  market: MarketId,
  mode: string,
  now: Date = new Date(),
): boolean {
  if (!checkpointAtIso || mode !== "LIVE") return false;
  if (!isMarketOpenNow(market, now)) return false;
  const ts = Date.parse(checkpointAtIso);
  if (!Number.isFinite(ts)) return true;
  return now.getTime() - ts > LIVE_STALE_AFTER_MS;
}

export async function getSectorThrustSnapshot(
  market: MarketId,
  now: Date = new Date(),
): Promise<SectorThrustSnapshot> {
  const runs = await query<RunRow>(
    `select id, session_date::text, checkpoint_at, mode, rule_version, taxonomy_version,
            curve_version, status, unverified_reason, eligible_universe_count,
            unclassified_count, scan_duration_ms
       from public.sector_thrust_runs
      where market = $1
        and mode in ('LIVE', 'EOD')
      order by session_date desc, checkpoint_at desc
      limit 1`,
    [market],
  ).catch((err) => {
    console.error("[sector-thrust] run query failed:", err instanceof Error ? err.message : err);
    return [];
  });

  const run = runs[0];
  if (!run) {
    return {
      market,
      sessionDate: null,
      checkpointAt: null,
      mode: "LIVE",
      ruleVersion: null,
      taxonomyVersion: null,
      curveVersion: null,
      status: "UNVERIFIED",
      stale: false,
      unverifiedReason:
        market === "US"
          ? "US live Sector Thrust scan is disabled pending India 5-session soak and US feed/curve verification."
          : "No Sector Thrust checkpoint has been persisted yet for this market.",
      eligibleUniverseCount: 0,
      unclassifiedCount: 0,
      scanDurationMs: 0,
      activeGroupCount: 0,
      fadedGroupCount: 0,
      unverifiedGroupCount: 0,
      groups: [],
    };
  }

  const runId = Number(run.id);
  const checkpointAt = toIsoTs(run.checkpoint_at);
  const stale = isSectorThrustRunStale(checkpointAt, market, run.mode, now);

  const [groupRows, memberRows] = await Promise.all([
    query<GroupRow>(
      `select id, group_level, group_key, group_label, parent_sector, status,
              unverified_reason, eligible_count, price_fresh_count, volume_fresh_count,
              qualifying_count, median_return_pct, median_rvol, volume_confirmation_route,
              first_triggered_at, related_news
         from public.sector_thrust_groups
        where run_id = $1
        order by
          case status
            when 'ACTIVE' then 0
            when 'FADED' then 1
            when 'WATCH' then 2
            when 'UNVERIFIED' then 3
            else 4
          end asc,
          case group_level when 'INDUSTRY' then 0 else 1 end asc,
          median_return_pct desc nulls last,
          group_label asc`,
      [runId],
    ).catch((err) => {
      console.error("[sector-thrust] groups query failed:", err instanceof Error ? err.message : err);
      return [];
    }),

    query<MemberRow>(
      `select m.group_id, m.asset_id::text, m.ticker, m.name, m.role, m.price,
              m.return_pct, m.rvol, m.avg_traded_value_20d, m.atr_pct, m.atr_extension,
              m.first_seen_at, m.reason, m.reference_entry, m.invalidation_stop, m.target_zone
         from public.sector_thrust_members m
         join public.sector_thrust_groups g on g.id = m.group_id
        where g.run_id = $1
        order by m.group_id, m.role, m.return_pct desc`,
      [runId],
    ).catch((err) => {
      console.error("[sector-thrust] members query failed:", err instanceof Error ? err.message : err);
      return [];
    }),
  ]);

  const membersByGroup = new Map<number, { leaders: SectorThrustMemberView[]; catchUp: SectorThrustMemberView[] }>();
  for (const m of memberRows) {
    const gid = Number(m.group_id);
    let entry = membersByGroup.get(gid);
    if (!entry) {
      entry = { leaders: [], catchUp: [] };
      membersByGroup.set(gid, entry);
    }
    const view: SectorThrustMemberView = {
      assetId: m.asset_id,
      ticker: m.ticker,
      name: m.name ?? m.ticker,
      role: m.role as SectorThrustMemberRole,
      price: Number(m.price),
      returnPct: Number(m.return_pct),
      rvol: toNum(m.rvol),
      avgTradedValue20d: toNum(m.avg_traded_value_20d),
      atrPct: toNum(m.atr_pct),
      atrExtension: toNum(m.atr_extension),
      firstSeenAt: toIsoTs(m.first_seen_at) ?? "",
      reason: m.reason,
      referenceEntry: toNum(m.reference_entry),
      invalidationStop: toNum(m.invalidation_stop),
      targetZone: toNum(m.target_zone),
    };
    if (view.role === "LEADER") entry.leaders.push(view);
    else entry.catchUp.push(view);
  }

  const groups: SectorThrustGroupView[] = groupRows.map((g) => {
    const gid = Number(g.id);
    const bucket = membersByGroup.get(gid) ?? { leaders: [], catchUp: [] };
    const news: SectorThrustNewsItem[] = Array.isArray(g.related_news)
      ? (g.related_news as SectorThrustNewsItem[])
      : [];
    return {
      id: gid,
      groupLevel: g.group_level as SectorThrustGroupLevel,
      groupKey: g.group_key,
      groupLabel: g.group_label,
      parentSector: g.parent_sector,
      status: g.status as SectorThrustGroupStatus,
      unverifiedReason: g.unverified_reason,
      eligibleCount: Number(g.eligible_count),
      priceFreshCount: Number(g.price_fresh_count),
      volumeFreshCount: Number(g.volume_fresh_count),
      qualifyingCount: Number(g.qualifying_count),
      medianReturnPct: toNum(g.median_return_pct),
      medianRvol: toNum(g.median_rvol),
      volumeConfirmationRoute: g.volume_confirmation_route,
      firstTriggeredAt: toIsoTs(g.first_triggered_at),
      relatedNews: news,
      leaders: bucket.leaders,
      catchUp: bucket.catchUp,
    };
  });

  const effectiveStatus: SectorThrustRunStatus = stale
    ? "STALE"
    : (run.status as SectorThrustRunStatus);

  return {
    market,
    sessionDate: run.session_date,
    checkpointAt,
    mode: run.mode,
    ruleVersion: run.rule_version,
    taxonomyVersion: run.taxonomy_version,
    curveVersion: run.curve_version,
    status: effectiveStatus,
    stale,
    unverifiedReason: stale
      ? "Latest live Sector Thrust checkpoint is more than 10 minutes old."
      : run.unverified_reason,
    eligibleUniverseCount: Number(run.eligible_universe_count),
    unclassifiedCount: Number(run.unclassified_count),
    scanDurationMs: Number(run.scan_duration_ms),
    activeGroupCount: groups.filter((g) => g.status === "ACTIVE").length,
    fadedGroupCount: groups.filter((g) => g.status === "FADED").length,
    unverifiedGroupCount: groups.filter((g) => g.status === "UNVERIFIED").length,
    groups,
  };
}
