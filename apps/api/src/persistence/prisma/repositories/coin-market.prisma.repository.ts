import { Injectable } from '@nestjs/common';
import type {
  CoinProvider,
  MarketCoin,
} from '../../../rates/domain/coin-choice';
import { CoinMarketRepositoryPort } from '../../../rates/ports/coin-market.repository.port';
import { toIsoString } from '../mappers/scalar.mapper';
import { PrismaService } from '../prisma.service';

const CHUNK = 200;

@Injectable()
export class CoinMarketPrismaRepository extends CoinMarketRepositoryPort {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async fetchedAt(provider: CoinProvider): Promise<string | null> {
    const row = await this.prisma.coinMarket.findFirst({
      where: { provider },
      orderBy: { fetchedAt: 'desc' },
      select: { fetchedAt: true },
    });
    return row ? toIsoString(row.fetchedAt) : null;
  }

  async listBySymbols(
    provider: CoinProvider,
    symbols: readonly string[],
  ): Promise<MarketCoin[]> {
    if (symbols.length === 0) return [];
    const rows = await this.prisma.coinMarket.findMany({
      where: { provider, symbol: { in: [...symbols] } },
      orderBy: [{ symbol: 'asc' }, { marketCapRank: 'asc' }, { coinId: 'asc' }],
    });
    return rows.map(toCoin);
  }

  async listShared(
    provider: CoinProvider,
    maxRank: number,
  ): Promise<MarketCoin[]> {
    const groups = await this.prisma.coinMarket.groupBy({
      by: ['symbol'],
      where: { provider, marketCapRank: { lte: maxRank } },
      having: { symbol: { _count: { gt: 1 } } },
    });
    if (groups.length === 0) return [];
    const rows = await this.prisma.coinMarket.findMany({
      where: {
        provider,
        marketCapRank: { lte: maxRank },
        symbol: { in: groups.map((g) => g.symbol) },
      },
      orderBy: [{ symbol: 'asc' }, { marketCapRank: 'asc' }, { coinId: 'asc' }],
    });
    return rows.map(toCoin);
  }

  async replace(
    provider: CoinProvider,
    coins: readonly MarketCoin[],
    fetchedAt: string,
  ): Promise<void> {
    const at = new Date(fetchedAt);
    await this.prisma.$transaction(async (tx) => {
      await tx.coinMarket.deleteMany({ where: { provider } });
      for (let start = 0; start < coins.length; start += CHUNK) {
        await tx.coinMarket.createMany({
          data: coins.slice(start, start + CHUNK).map((c) => ({
            provider,
            coinId: c.id,
            symbol: c.symbol,
            name: c.name,
            marketCapRank: c.marketCapRank,
            priceUsd: c.priceUsd,
            fetchedAt: at,
          })),
        });
      }
    });
  }
}

function toCoin(row: {
  provider: string;
  coinId: string;
  name: string;
  symbol: string;
  marketCapRank: number;
  priceUsd: string | null;
}): MarketCoin {
  return {
    provider: row.provider as CoinProvider,
    id: row.coinId,
    name: row.name,
    symbol: row.symbol,
    marketCapRank: row.marketCapRank,
    priceUsd: row.priceUsd,
  };
}
