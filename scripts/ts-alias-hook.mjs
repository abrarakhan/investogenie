// Resolve hook so plain `node` can run the app's TypeScript modules directly.
//
// Node 24 strips TypeScript types natively, but it does not read tsconfig, so the "@/*" path
// alias the app uses everywhere would fail to resolve. This maps "@/x" to <repo root>/x, which
// is all scripts/run-scan.mjs needs to import lib/ingest/signals.ts without a build step.
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { pathToFileURL, fileURLToPath } from "node:url";
import { dirname, join, extname } from "node:path";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

// TypeScript imports omit the file extension; Node's ESM resolver requires one.
const CANDIDATES = [".ts", ".tsx", ".js", ".mjs", "/index.ts", "/index.tsx"];
function withExtension(absolutePath) {
  if (extname(absolutePath) && existsSync(absolutePath)) return absolutePath;
  for (const suffix of CANDIDATES) {
    const candidate = `${absolutePath}${suffix}`;
    if (existsSync(candidate)) return candidate;
  }
  return absolutePath;
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      const resolved = withExtension(join(repoRoot, specifier.slice(2)));
      return nextResolve(pathToFileURL(resolved).href, context);
    }
    // Relative imports between the app's own TS modules need the same treatment.
    if ((specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL?.endsWith(".ts")) {
      const resolved = withExtension(join(dirname(fileURLToPath(context.parentURL)), specifier));
      return nextResolve(pathToFileURL(resolved).href, context);
    }
    return nextResolve(specifier, context);
  },
});
