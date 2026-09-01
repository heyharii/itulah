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
  },
  {
    // Generated code: the shadcn ui primitives and the openstatus data-table
    // registry (`npx shadcn add https://data-table.openstatus.dev/r/*.json`),
    // neither written here. These files are ours to edit — that is the shadcn model —
    // but they are also replaced wholesale by the next `shadcn add`, so
    // house-style lint findings in them would be re-introduced every update.
    // Type errors are a different matter and were fixed in place: those stop
    // the build. Anything WE write against this table is linted normally.
    files: [
      'src/components/ui/**',
      'src/components/data-table/**',
      'src/components/custom/**',
      'src/lib/store/**',
      'src/lib/table/**',
      'src/lib/table-schema/**',
      'src/lib/data-table/**',
      'src/lib/react-table.d.ts',
      'src/lib/compose-refs.ts',
      'src/lib/date-preset.ts',
      'src/lib/colors.ts',
      'src/components/controls.tsx',
      'src/hooks/use-media-query.ts',
      'src/hooks/use-hot-key.ts',
      'src/hooks/use-local-storage.ts',
      'src/hooks/use-debounce.ts',
    ],
    // Their own eslint-disable comments were written for the registry's lint
    // setup, which is not this one; an unused directive there is not a finding.
    linterOptions: { reportUnusedDisableDirectives: 'off' },
    rules: {
      'no-empty': 'off',
      'no-case-declarations': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      'react-refresh/only-export-components': 'off',
      'react-hooks/exhaustive-deps': 'off',
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/use-memo': 'off',
      'no-useless-assignment': 'off',
    },
  },
])
