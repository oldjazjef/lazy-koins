import { Test } from '@nestjs/testing';
import { IdentityTokenVerifierPort } from '../auth/ports/identity-token-verifier.port';
import { UpdateProjectHandler } from '../projects/application/commands/update-project.command';
import { AppModule } from './app.module';

/**
 * Compiles the whole module graph — every provider must be resolvable — without opening a
 * database connection (PrismaService connects in onModuleInit, which `compile()` does not run).
 * The environment placeholders come from vitest.config.ts. Catches the classic Nest failure of a
 * handler depending on a port no module binds.
 */
describe('AppModule', () => {
  it('resolves every provider', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    // A handler that needs a repository port, and the global integration port.
    expect(moduleRef.get(UpdateProjectHandler)).toBeInstanceOf(
      UpdateProjectHandler,
    );
    expect(moduleRef.get(IdentityTokenVerifierPort)).toBeDefined();
    await moduleRef.close();
  });
});
