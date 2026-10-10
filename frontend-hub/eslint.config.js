import js from "@eslint/js"
import globals from "globals"
import reactHooks from "eslint-plugin-react-hooks"
import reactRefresh from "eslint-plugin-react-refresh"
import tseslint from "typescript-eslint"
import { defineConfig, globalIgnores } from "eslint/config"

// Everything in this app is hand-written against Base UI, so unlike
// `frontend-cloud` there is no generated-registry escape hatch: one rule set
// applies to every file.
export default defineConfig([
  globalIgnores(["dist"]),
  {
    files: ["**/*.{ts,tsx}"],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: { globals: globals.browser },
  },
  {
    // The owner's floor: nothing on a screen is set below 14px (2026-09-26).
    // The type scale (`--text-*`) is all at or above it; what slips under is a
    // raw size typed into a class — `text-[0.75rem]`, `text-[11px]`, `text-xs`
    // — which is how 26 places got there. A printed page is paper and says so
    // with an `eslint-disable-next-line`.
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-syntax": [
        "error",
        ...[
          "Literal[value=/text-\\[(?:0?\\.[0-7]\\d*|0?\\.8[0-6]\\d*|0?\\.8)rem\\]|text-\\[(?:\\d|1[0-3])px\\]|\\btext-xs\\b/]",
          "TemplateElement[value.raw=/text-\\[(?:0?\\.[0-7]\\d*|0?\\.8[0-6]\\d*|0?\\.8)rem\\]|text-\\[(?:\\d|1[0-3])px\\]|\\btext-xs\\b/]",
        ].map((selector) => ({
          selector,
          message:
            "Text under 14px. Use the type scale (`text-meta`, `text-pill`, …) or `text-[0.875rem]` at the least.",
        })),
      ],
    },
  },
  {
    // Dates are written one way. Every date and time the hub draws comes from
    // `src/lib/format.ts` (`day`, `dayTime`, `dayMonth`, `weekday`,
    // `monthYear`, `dateRange`, `time`, `clock`, `ago`), so the locale, the
    // month names, the zero-padding and the separator are decided in one file
    // and nowhere else. (`no-restricted-properties`, not `-syntax`: a second
    // `no-restricted-syntax` block would replace the 14px rule above.)
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/lib/format.ts"],
    rules: {
      "no-restricted-properties": [
        "error",
        {
          property: "toLocaleDateString",
          message:
            "Format dates with the helpers in src/lib/format.ts (day, dayTime, dayMonth, weekday, monthYear).",
        },
        {
          property: "toLocaleTimeString",
          message:
            "Format times with time() or clock() from src/lib/format.ts.",
        },
        {
          object: "Intl",
          property: "DateTimeFormat",
          message:
            "Format dates with the helpers in src/lib/format.ts (dateText for a shape they do not cover).",
        },
      ],
    },
  },
])
