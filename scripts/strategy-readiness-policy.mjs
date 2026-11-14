const VALID_MARKETS = new Set(["IN", "US", "ALL"]);

export function readinessMarkets(argv = []) {
  let selected = "ALL";
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--market") {
      if (!argv[index + 1]) throw new Error("--market requires IN, US or ALL");
      selected = argv[index + 1].toUpperCase();
      index += 1;
    } else if (argument.startsWith("--market=")) {
      selected = argument.slice("--market=".length).toUpperCase();
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  if (!VALID_MARKETS.has(selected)) throw new Error(`Invalid market ${selected}; expected IN, US or ALL`);
  return selected === "ALL" ? ["IN", "US"] : [selected];
}
