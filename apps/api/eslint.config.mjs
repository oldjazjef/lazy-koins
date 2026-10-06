import baseConfig from '../../eslint.config.mjs';

export default [
  ...baseConfig,
  {
    // Generated Prisma Client: machine output, overwritten by `prisma generate`.
    ignores: ['src/generated/**'],
  },
  {
    files: ['**/*.ts'],
    rules: {
      // Only src/persistence may hold a database client; features depend on a repository port.
      '@nx/workspace-no-direct-prisma-access': 'error',
      // Nest resolves constructor parameters by type, so the decorator metadata is the point of
      // these declarations even when nothing in the body references them.
      '@typescript-eslint/no-useless-constructor': 'off',
    },
  },
  {
    // The same fence for the external SDKs: only src/integrations may import them, everything
    // else depends on a port (IdentityTokenVerifierPort today).
    files: ['**/*.ts'],
    ignores: ['src/integrations/**'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['firebase-admin', 'firebase-admin/*'],
              message:
                'External SDKs live in src/integrations only. Depend on the port instead (see CLAUDE.md, "Persistence architecture").',
            },
          ],
        },
      ],
    },
  },
];
