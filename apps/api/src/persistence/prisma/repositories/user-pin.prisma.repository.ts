import { Injectable } from '@nestjs/common';
import type { UserPin as UserPinRow } from '../../../generated/prisma/client';
import type { SaveUserPinInput, UserPin } from '../../../pin/domain/pin';
import { UserPinRepositoryPort } from '../../../pin/ports/user-pin.repository.port';
import { toIsoString } from '../mappers/scalar.mapper';
import { PrismaService } from '../prisma.service';

function toPin(row: UserPinRow): UserPin {
  return {
    userId: row.userId,
    pinHash: row.pinHash,
    failedAttempts: row.failedAttempts,
    nextAttemptAt: row.nextAttemptAt ? toIsoString(row.nextAttemptAt) : null,
    reloginRequiredAt: row.reloginRequiredAt
      ? toIsoString(row.reloginRequiredAt)
      : null,
    autoLockMinutes: row.autoLockMinutes,
    updatedAt: toIsoString(row.updatedAt),
  };
}

@Injectable()
export class UserPinPrismaRepository extends UserPinRepositoryPort {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async find(userId: string): Promise<UserPin | undefined> {
    const row = await this.prisma.userPin.findUnique({ where: { userId } });
    return row ? toPin(row) : undefined;
  }

  async save(userId: string, input: SaveUserPinInput): Promise<UserPin> {
    const data = {
      pinHash: input.pinHash,
      failedAttempts: input.failedAttempts,
      nextAttemptAt: input.nextAttemptAt ? new Date(input.nextAttemptAt) : null,
      reloginRequiredAt: input.reloginRequiredAt
        ? new Date(input.reloginRequiredAt)
        : null,
      autoLockMinutes: input.autoLockMinutes,
    };
    const row = await this.prisma.userPin.upsert({
      where: { userId },
      create: { userId, ...data },
      update: data,
    });
    return toPin(row);
  }

  async remove(userId: string): Promise<boolean> {
    const { count } = await this.prisma.userPin.deleteMany({
      where: { userId },
    });
    return count > 0;
  }
}
