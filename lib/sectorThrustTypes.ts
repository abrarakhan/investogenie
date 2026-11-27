import type { MarketId } from "@/lib/types";

export type SectorThrustGroupLevel = "INDUSTRY" | "SECTOR";
export type SectorThrustGroupStatus = "ACTIVE" | "FADED" | "WATCH" | "UNVERIFIED" | "INCONCLUSIVE";
export type SectorThrustRunStatus = "LIVE" | "EOD" | "STALE" | "UNVERIFIED" | "INCONCLUSIVE";
export type SectorThrustMemberRole = "LEADER" | "CATCH_UP";

export interface SectorThrustNewsItem {
  title: string;
  source: string;
  publishedAt: string | null;
  url: string | null;
}

export interface SectorThrustMemberView {
  assetId: string;
  ticker: string;
  name: string;
  role: SectorThrustMemberRole;
  price: number;
  returnPct: number;
  rvol: number | null;
  avgTradedValue20d: number | null;
  atrPct: number | null;
  atrExtension: number | null;
  firstSeenAt: string;
  reason: string;
  referenceEntry: number | null;
  invalidationStop: number | null;
  targetZone: number | null;
}

export interface SectorThrustGroupView {
  id: number;
  groupLevel: SectorThrustGroupLevel;
  groupKey: string;
  groupLabel: string;
  parentSector: string | null;
  status: SectorThrustGroupStatus;
  unverifiedReason: string | null;
  eligibleCount: number;
  priceFreshCount: number;
  volumeFreshCount: number;
  qualifyingCount: number;
  medianReturnPct: number | null;
  medianRvol: number | null;
  volumeConfirmationRoute: string | null;
  firstTriggeredAt: string | null;
  relatedNews: SectorThrustNewsItem[];
  leaders: SectorThrustMemberView[];
  catchUp: SectorThrustMemberView[];
}

export interface SectorThrustSnapshot {
  market: MarketId;
  sessionDate: string | null;
  checkpointAt: string | null;
  mode: string;
  ruleVersion: string | null;
  taxonomyVersion: string | null;
  curveVersion: string | null;
  status: SectorThrustRunStatus;
  stale: boolean;
  unverifiedReason: string | null;
  eligibleUniverseCount: number;
  unclassifiedCount: number;
  scanDurationMs: number;
  activeGroupCount: number;
  fadedGroupCount: number;
  unverifiedGroupCount: number;
  groups: SectorThrustGroupView[];
}
