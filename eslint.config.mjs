import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Local/Python/analysis junk — never lint these (a venv walk OOMs ESLint).
    ".venv/**",
    ".claude/worktrees/**",
    "**/__pycache__/**",
    "**/*.pyc",
    "data/**",
    ".pycache_tmp/**",
  ]),
]);

export default eslintConfig;
