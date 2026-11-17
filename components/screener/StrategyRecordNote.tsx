import { STRONG_SWING_MODEL_VERSION } from "@/lib/analytics/strongSwing";
import type { StrategyRecord } from "@/lib/strategyRecord";

/**
 * The strategy's measured record, shown where the buy decision is made.
 *
 * The gates agreeing with each other is not evidence that the setup works, and until
 * this existed that was the only thing the screen offered a reader. The caveats are
 * not small print: a record that omits delisted stocks and trading costs is flattering
 * itself, and saying so beside the number is the difference between evidence and
 * reassurance.
 */
const signed = (value: number, digits = 2) => `${value >= 0 ? "+" : ""}${value.toFixed(digits)}%`;
const tone = (value: number) => (value > 0 ? "text-emerald-300" : value < 0 ? "text-orange-300" : "text-white/70");

export default function StrategyRecordNote({ record }: { record: StrategyRecord | null }) {
  if (!record) {
    return (
      <p className="mt-3 text-[11px] leading-relaxed text-white/38">
        No measured record for this strategy yet. Run the historical replay to produce one.
      </p>
    );
  }
  // A record measured under an earlier model describes rules the screen no longer follows.
  // Saying nothing would leave a number beside the Buy button that looks like evidence for
  // the gates above it; v8's entry_open gate alone removed 730 of the 1,295 entries the v7
  // figures were drawn from. Re-run pipelines/strong_swing_replay.py to replace it.
  const stale = record.modelVersion !== STRONG_SWING_MODEL_VERSION;
  const unevaluated = [
    ...(record.liveExecutionEvaluated ? [] : ["live quote", "spread", "circuit"]),
    ...(record.resultsEvaluated ? [] : ["results blackout"]),
  ];
  // "a and b and c" is what naive joining produced; the last item takes the "and".
  const listed = unevaluated.length < 2
    ? unevaluated.join("")
    : `${unevaluated.slice(0, -1).join(", ")} and ${unevaluated.at(-1)}`;
  return (
    <div className="mt-3 rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2.5">
      <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/45">
        Measured record
      </div>
      <div className="mt-1.5 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-[12px] text-white/70">
        <span>
          <span className="font-mono text-base font-bold text-white/85">{record.winRatePct.toFixed(0)}%</span> win rate
        </span>
        <span>
          <span className={`font-mono text-base font-bold ${tone(record.expectancyPct)}`}>{signed(record.expectancyPct)}</span> average per signal
        </span>
        <span className="text-white/45">
          {record.trades} replayed trades, {record.fromYear}&ndash;{record.toYear}
        </span>
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-white/45">
        <span>Median {signed(record.medianPct)}</span>
        <span>Win {signed(record.averageWinPct)} over {record.targetHits} targets</span>
        <span>Loss {signed(record.averageLossPct)} over {record.stopHits} stops</span>
        <span>Held to {record.horizonSessions} sessions</span>
        {record.latestYear && (
          <span className={tone(record.latestYear.expectancyPct)}>
            {record.latestYear.year}: {signed(record.latestYear.expectancyPct)} over {record.latestYear.trades}
          </span>
        )}
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-white/32">
        {stale && (
          <span className="text-orange-300/80">
            Measured under {record.modelVersion}, not the {STRONG_SWING_MODEL_VERSION} rules the
            gates above use; it does not describe the current strategy.{" "}
          </span>
        )}
        Replayed from completed bars, entering at the next session&rsquo;s open. Before brokerage,
        taxes and slippage. Delisted stocks are not in the sample, which flatters every figure above.
        {unevaluated.length > 0 && ` The ${listed} gate${unevaluated.length > 1 ? "s were" : " was"} not replayed, so live trading is stricter than this.`}
        {" "}Past results do not predict the next trade.
      </p>
    </div>
  );
}
