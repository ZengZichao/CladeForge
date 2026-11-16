import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'

// Flat config (ESLint v10). The frontend is TypeScript + React 18 on Vite, so
// the gate covers JS/TS correctness (js.configs.recommended + typescript-eslint
// recommended), the Rules of Hooks, and Fast Refresh export hygiene. The Rust
// side is linted separately by `cargo clippy -D warnings` in ci.yml.
//
// React-hooks rules are selected individually rather than via the plugin's
// `recommended` bundle. That bundle targets the React 19 / React Compiler
// era and enables `refs`, `set-state-in-effect` and `immutability`, which flag
// 80+ sites in this React 18 codebase and read as a request for a render-path
// rewrite, not a lint fix. They are deliberately left off; `rules-of-hooks`
// and `exhaustive-deps` are the rules that actually catch bugs here.
export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'dist-ssr/**',
      'coverage/**',
      'src-tauri/**',
      'node_modules/**',
      'scripts/cross-check/fixtures/**',
    ],
  },
  {
    languageOptions: {
      ecmaVersion: 2020,
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],
      // Leading-underscore names are the project's "intentionally unused"
      // convention; `tsc` already rejects genuinely unused locals.
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  },
)
