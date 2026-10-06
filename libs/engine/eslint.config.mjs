import baseConfig from '../../eslint.config.mjs';

/**
 * libs/engine is PURE (CLAUDE.md, Determinism F7.6): a function of bookings, corrections, rate
 * table and country rules. These fences make the rule mechanical instead of a review comment:
 * no framework, no database, no network, no file system, no clock, no randomness.
 */
const FRAMEWORKS = {
  group: [
    '@angular/*',
    '@nestjs/*',
    '@prisma/*',
    'prisma',
    '**/generated/prisma/**',
    'firebase',
    'firebase/*',
    'firebase-admin',
    'firebase-admin/*',
    'rxjs',
    'rxjs/*',
  ],
  message:
    'libs/engine is pure TypeScript: no Angular, Nest, Prisma or Firebase. Hand data in from the API instead.',
};

const IO = {
  group: [
    'node:*',
    'fs',
    'fs/*',
    'path',
    'http',
    'https',
    'net',
    'child_process',
    'axios',
    'undici',
  ],
  message:
    'libs/engine does no I/O — no file system, no network. The caller reads files and fetches rates, then hands the data in.',
};

const APPS = {
  group: ['**/apps/**', '@lazykoins/ui', '@lazykoins/ui/*'],
  message: 'libs/engine must not depend on an app or on UI code.',
};

export default [
  ...baseConfig,
  {
    files: ['**/*.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        { patterns: [FRAMEWORKS, IO, APPS] },
      ],
      'no-restricted-globals': [
        'error',
        {
          name: 'fetch',
          message: 'No network inside the engine (F7.6, F11.3).',
        },
        {
          name: 'XMLHttpRequest',
          message: 'No network inside the engine (F7.6, F11.3).',
        },
        {
          name: 'WebSocket',
          message: 'No network inside the engine (F7.6, F11.3).',
        },
        {
          name: 'process',
          message: 'No environment inside the engine: pass settings in.',
        },
      ],
      'no-restricted-properties': [
        'error',
        {
          object: 'Date',
          property: 'now',
          message:
            'No clock inside the engine (F7.6): the caller passes the date in.',
        },
        {
          object: 'Math',
          property: 'random',
          message: 'No randomness inside the engine (F7.6).',
        },
        {
          object: 'Number',
          property: 'parseFloat',
          message:
            'Never parse amounts through `number` — use parseDecimal (money/decimal.ts).',
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.name='parseFloat']",
          message:
            'Never parse amounts through `number` — use parseDecimal (money/decimal.ts).',
        },
        {
          selector: "NewExpression[callee.name='Date'][arguments.length=0]",
          message:
            'No clock inside the engine (F7.6): `new Date()` without an argument reads the current time.',
        },
      ],
    },
  },
  {
    // The golden test (A1) is the one place that looks at the disk — whether private/golden.json
    // exists — and specs may use Node for fixtures. Production code may not.
    files: ['**/*.spec.ts', 'vitest.config.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        { patterns: [FRAMEWORKS, APPS] },
      ],
    },
  },
];
