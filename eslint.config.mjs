// Minimal lint guard against re-accumulation (Phase 5 refactor).
// Intentionally warning-only and rule-light: tsc handles correctness; this
// only flags files growing past the size where they should be split.
import tseslint from "typescript-eslint";

export default [
  {
    ignores: ["dist/**", "functions/lib/**", "node_modules/**", "functions/node_modules/**"],
  },
  {
    files: ["src/**/*.{ts,tsx}", "functions/src/**/*.ts", "scripts/**/*.mjs"],
    languageOptions: {
      parser: tseslint.parser,
    },
    rules: {
      "max-lines": ["warn", { max: 600, skipBlankLines: true, skipComments: true }],
    },
  },
];
