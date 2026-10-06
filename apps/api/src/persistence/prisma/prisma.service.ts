import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  Injectable,
  Logger,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import type { Env } from '../../config/env';
import { PrismaClient } from '../../generated/prisma/client';
import { sqliteFilePath } from './sqlite-url';

/**
 * The Prisma Client, application-wide, on SQLite.
 *
 * Prisma 7 has no Rust query engine and requires a driver adapter; for SQLite that is
 * better-sqlite3, which opens the database file in-process. Consequences worth knowing:
 *
 * - **One process owns the file.** SQLite allows one writer at a time; run a single API replica
 *   (see CLAUDE.md, Database). Readers do not block thanks to WAL mode, set below.
 * - The directory is created if missing, so a fresh volume works; the *schema* still comes only
 *   from `prisma migrate deploy` (the container runs it before starting).
 *
 * Only the adapters in `persistence/prisma/repositories` may touch this.
 */
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnApplicationShutdown
{
  private readonly logger = new Logger(PrismaService.name);

  constructor(config: ConfigService<Env, true>) {
    const file = sqliteFilePath(config.get('DATABASE_URL', { infer: true }));
    mkdirSync(dirname(file), { recursive: true });
    super({ adapter: new PrismaBetterSqlite3({ url: `file:${file}` }) });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    // WAL: readers no longer wait for a writer, and a crash cannot leave a half-written page.
    // busy_timeout: a writer waits up to 5 s for the lock instead of failing with SQLITE_BUSY.
    await this.$executeRawUnsafe('PRAGMA journal_mode = WAL');
    await this.$executeRawUnsafe('PRAGMA busy_timeout = 5000');
  }

  /** Fired because main.ts calls `app.enableShutdownHooks()`. */
  async onApplicationShutdown(): Promise<void> {
    await this.$disconnect();
    this.logger.log('Database closed');
  }
}
