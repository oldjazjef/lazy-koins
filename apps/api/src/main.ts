import { bootstrap } from './bootstrap';

// The server entry point (container, `pnpm start:api`): everything comes from the environment.
// The desktop app calls the same `bootstrap` with its own options (see bootstrap.ts).
void bootstrap();
