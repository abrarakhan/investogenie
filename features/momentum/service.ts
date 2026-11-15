/**
 * Public server boundary for Momentum discovery.
 *
 * Calculation ownership remains exclusively in Python. The legacy lib modules
 * are transitional adapters that load inputs and call the Python strategy
 * bridge; consumers should import this feature service instead of those files.
 */
export { getMomentumIgnitionCandidates as getMomentumV2Candidates } from "@/lib/momentumIgnition";
export { getMomentumIgnitionCandidates as getMomentumLegacyCandidates } from "@/lib/momentumIgnitionLegacy";
export type {
  MomentumIgnitionCandidate,
  MomentumIgnitionCandidateStatus,
  MomentumIgnitionResult,
} from "@/lib/momentumIgnition";
export type {
  MomentumIgnitionCandidate as LegacyMomentumIgnitionCandidate,
  MomentumIgnitionResult as LegacyMomentumIgnitionResult,
} from "@/lib/momentumIgnitionLegacy";
