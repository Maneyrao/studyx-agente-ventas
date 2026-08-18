import { defineConfig, globalIgnores } from 'eslint/config';
import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypeScript from 'eslint-config-next/typescript';

export default defineConfig([
  ...nextCoreWebVitals,
  ...nextTypeScript,
  globalIgnores([
    '.next/**',
    'out/**',
    'build/**',
    'coverage/**',
    'botpress-agent/**',
    // Worktrees are separate checkouts of this same repo (git-ignored, see
    // .gitignore). Linting them re-reports every problem in whatever branch
    // each one has checked out — 6607 of them today, all duplicates of code
    // that is not part of the current tree. It also defeats the
    // `botpress-agent/**` ignore above, since there the path is prefixed.
    // The result was a `npm run lint` that could never exit clean, which is
    // how a real lint error would go unnoticed.
    '.worktrees/**',
    'next-env.d.ts',
  ]),
]);

