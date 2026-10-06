import { RuleTester } from '@typescript-eslint/rule-tester';
import { afterAll, describe, it } from 'vitest';
import { RULE_NAME, rule } from './no-direct-prisma-access';

RuleTester.afterAll = afterAll;
RuleTester.describe = describe;
RuleTester.it = it;

const ruleTester = new RuleTester();

const featureFile = 'c:/repo/apps/api/src/projects/projects.service.ts';
const persistenceFile =
  'c:/repo/apps/api/src/persistence/prisma/prisma.service.ts';
const generatedFile = 'c:/repo/apps/api/src/generated/prisma/client.ts';

ruleTester.run(RULE_NAME, rule, {
  valid: [
    {
      name: 'a feature importing a repository port',
      filename: featureFile,
      code: `import { ProjectRepositoryPort } from './ports/project.repository.port';`,
    },
    {
      name: 'the persistence layer itself may hold a client',
      filename: persistenceFile,
      code: `import { PrismaClient } from '../../generated/prisma/client';`,
    },
    {
      name: 'an adapter may import the adapter package',
      filename: persistenceFile,
      code: `import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';`,
    },
    {
      name: 'the generated client is exempt',
      filename: generatedFile,
      code: `import * as runtime from '@prisma/client';`,
    },
    {
      name: 'an unrelated import that merely mentions prisma in a comment',
      filename: featureFile,
      code: `// prisma is bound in PersistenceModule\nimport { Injectable } from '@nestjs/common';`,
    },
    {
      name: 'AppModule may import the module class itself — it has to, to register it',
      filename: 'c:/repo/apps/api/src/app/app.module.ts',
      code: `import { PersistenceModule } from '../persistence/persistence.module';`,
    },
  ],
  invalid: [
    {
      name: 'a feature importing the generated client',
      filename: featureFile,
      code: `import { PrismaClient } from '../../generated/prisma/client';`,
      errors: [{ messageId: 'directPrismaAccess' }],
    },
    {
      name: 'aliasing does not help — the specifier is what is matched',
      filename: featureFile,
      code: `import { PrismaService as P } from '../../persistence/prisma/prisma.service';`,
      errors: [{ messageId: 'directPrismaAccess' }],
    },
    {
      name: 'reaching for a client re-exported by the persistence module',
      filename: featureFile,
      code: `import { PrismaService } from '../persistence/persistence.module';`,
      errors: [{ messageId: 'directPrismaAccess' }],
    },
    {
      name: 'a dynamic import is not a back door',
      filename: featureFile,
      code: `const c = await import('@prisma/client');`,
      errors: [{ messageId: 'directPrismaAccess' }],
    },
    {
      name: 'nor is require',
      filename: featureFile,
      code: `const c = require('@prisma/client');`,
      errors: [{ messageId: 'directPrismaAccess' }],
    },
  ],
});
