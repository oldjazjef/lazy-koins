import { ESLintUtils, type TSESTree } from '@typescript-eslint/utils';

export const RULE_NAME = 'no-direct-prisma-access';

/**
 * Import sources that mean "you are holding a database client".
 *
 * Matched on the *specifier*, not on the identifier, so aliasing (`import { PrismaService as P }`)
 * cannot slip past, and a mention inside a comment or a string is not a match.
 */
const FORBIDDEN_SOURCES = [
  '@prisma/client',
  '@prisma/adapter-better-sqlite3',
  'generated/prisma',
  'prisma/prisma.service',
];

/**
 * `persistence.module` is a special case: `AppModule` has to import `PersistenceModule` to register
 * it, so the module itself is fine. What must not leave the persistence layer are the client handles
 * it might also re-export.
 */
const PERSISTENCE_MODULE_SOURCE = 'persistence.module';
const FORBIDDEN_PERSISTENCE_EXPORTS = ['PrismaService'];

/** Only `src/persistence/**` may hold a client. Path separators are normalised for Windows. */
const ALLOWED_PATH = /[\\/]src[\\/]persistence[\\/]/;

/** The generated client imports itself; linting it is pointless and it is git-ignored anyway. */
const GENERATED_PATH = /[\\/]src[\\/]generated[\\/]/;

export const rule = ESLintUtils.RuleCreator(() => __filename)({
  name: RULE_NAME,
  meta: {
    type: 'problem',
    docs: {
      description:
        'Database clients may only be used inside src/persistence. Features depend on a repository port.',
    },
    schema: [],
    messages: {
      directPrismaAccess:
        'Do not import "{{source}}" outside src/persistence. Features depend on a repository ' +
        'port, so the domain stays ORM-free and every query is written in exactly one place. ' +
        'Depend on a port instead — ' +
        'see "Persistence architecture" in CLAUDE.md.',
    },
  },
  defaultOptions: [],
  create(context) {
    const filename = context.filename;

    if (ALLOWED_PATH.test(filename) || GENERATED_PATH.test(filename)) {
      return {};
    }

    const check = (node: TSESTree.Node, source: string) => {
      if (FORBIDDEN_SOURCES.some((forbidden) => source.includes(forbidden))) {
        context.report({
          node,
          messageId: 'directPrismaAccess',
          data: { source },
        });
      }
    };

    return {
      ImportDeclaration(node) {
        const source = node.source.value;

        if (source.includes(PERSISTENCE_MODULE_SOURCE)) {
          for (const specifier of node.specifiers) {
            if (
              specifier.type === 'ImportSpecifier' &&
              specifier.imported.type === 'Identifier' &&
              FORBIDDEN_PERSISTENCE_EXPORTS.includes(specifier.imported.name)
            ) {
              context.report({
                node: specifier,
                messageId: 'directPrismaAccess',
                data: { source: specifier.imported.name },
              });
            }
          }
          return;
        }

        check(node, source);
      },
      // `await import('...')` and `require('...')` would otherwise be an open back door.
      ImportExpression(node) {
        if (
          node.source.type === 'Literal' &&
          typeof node.source.value === 'string'
        ) {
          check(node, node.source.value);
        }
      },
      CallExpression(node) {
        if (
          node.callee.type === 'Identifier' &&
          node.callee.name === 'require' &&
          node.arguments[0]?.type === 'Literal' &&
          typeof node.arguments[0].value === 'string'
        ) {
          check(node, node.arguments[0].value);
        }
      },
    };
  },
});
