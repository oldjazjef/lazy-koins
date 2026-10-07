import { Injectable } from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import {
  GetSettingsQuery,
  type SettingsChanges,
  type SettingsView,
  TestCoingeckoKeyCommand,
  UpdateSettingsCommand,
} from './application/settings.handlers';
import type { KeyCheckResult } from '../rates/ports/rate-source.port';
import type { PriceProviderId } from '../rates/domain/price-providers';
import {
  GetPriceSourcesQuery,
  type PriceSourcesView,
  type PriceSourceTestView,
  TestPriceSourceCommand,
} from './application/price-sources.handlers';

/** Thin façade over the buses — no logic here; it lives in the handlers. */
@Injectable()
export class SettingsService {
  constructor(
    private readonly commands: CommandBus,
    private readonly queries: QueryBus,
  ) {}

  get(userId: string): Promise<SettingsView> {
    return this.queries.execute(new GetSettingsQuery(userId));
  }

  update(userId: string, changes: SettingsChanges): Promise<SettingsView> {
    return this.commands.execute(new UpdateSettingsCommand(userId, changes));
  }

  testCoingeckoKey(userId: string, key?: string): Promise<KeyCheckResult> {
    return this.commands.execute(new TestCoingeckoKeyCommand(userId, key));
  }

  priceSources(userId: string): Promise<PriceSourcesView> {
    return this.queries.execute(new GetPriceSourcesQuery(userId));
  }

  testPriceSource(
    userId: string,
    provider: PriceProviderId,
    key?: string,
  ): Promise<PriceSourceTestView> {
    return this.commands.execute(
      new TestPriceSourceCommand(userId, provider, key),
    );
  }
}
