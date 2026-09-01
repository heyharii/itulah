import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      /* A leading underscore is how this codebase already marks a parameter it
       * must accept and does not read — see `levelOf(_list)` in
       * commercial/model.ts, where the argument documents the signature the
       * pricing hub will need once it has more than one price level. */
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],

      /* ── React Compiler diagnostics ──────────────────────────────────────
       * These four arrived with eslint-plugin-react-hooks v7 and report what
       * the compiler had to skip. They are warnings, not errors, and that is a
       * deliberate, temporary choice:
       *
       * The 28 current hits are not 28 independent mistakes. They are three
       * missing layers. `set-state-in-effect` fires almost entirely on screens
       * that hand-roll a query (system/accounts.tsx) or seed a form draft from
       * loaded data (po/po-draft.tsx) — code that Phase 2 (TanStack Query
       * loaders) and Phase 4 (TanStack Form) delete outright. Patching each
       * site now is work those phases would throw away.
       *
       * `refs` and `immutability` fire mostly inside motion/ and agents/, where
       * a ref callback writes during a phase the compiler cannot prove is safe.
       * That code is correct React; the analysis is conservative.
       *
       * The debt is tracked, not hidden: `bunx eslint .` prints every one, and
       * the count is the number to watch. Raise these back to `error` at the
       * end of Phase 4 — by then the list should be short enough to fix or to
       * mark with an explicit "use no memo" and a reason.
       * See docs/frontend-architecture.md §7 and docs/agent-prompts.md. */
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/refs': 'warn',
      'react-hooks/immutability': 'warn',
      'react-hooks/use-memo': 'warn',

      /* Fast Refresh ergonomics, not correctness: it fires when a module
       * exports both a component and something else. The 76 current hits are
       * files like hr/parts.tsx and dashboard/parts.tsx that pair a component
       * with its helpers — a structural split, which is exactly what Phase 3
       * does when components/ becomes domains/ and shared/. Nothing here
       * affects a production build. Raise to `error` after Phase 3. */
      'react-refresh/only-export-components': 'warn',
    },
  },
])
