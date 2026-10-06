import { Injectable } from '@nestjs/common';
import type { User as UserRow } from '../../../generated/prisma/client';
import type {
  PrincipalRecord,
  User,
  VerifiedIdentity,
} from '../../../users/domain/user';
import { UserRepositoryPort } from '../../../users/ports/user.repository.port';
import { toIsoString } from '../mappers/scalar.mapper';
import { PrismaService } from '../prisma.service';

function toUser(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    signInProvider: row.signInProvider,
    createdAt: toIsoString(row.createdAt),
    updatedAt: toIsoString(row.updatedAt),
  };
}

@Injectable()
export class UserPrismaRepository extends UserRepositoryPort {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async findById(id: string): Promise<User | undefined> {
    const row = await this.prisma.user.findUnique({ where: { id } });
    return row ? toUser(row) : undefined;
  }

  async findPrincipalByIdentityUid(
    uid: string,
  ): Promise<PrincipalRecord | undefined> {
    const row = await this.prisma.user.findUnique({
      where: { identityUid: uid },
      select: { id: true },
    });
    return row ?? undefined;
  }

  async upsertFromIdentity(
    identity: VerifiedIdentity,
    displayName: string,
  ): Promise<User> {
    const providerFields = {
      email: identity.email ?? '',
      signInProvider: identity.signInProvider,
    };
    const row = await this.prisma.user.upsert({
      where: { identityUid: identity.uid },
      update: providerFields,
      create: { identityUid: identity.uid, displayName, ...providerFields },
    });
    return toUser(row);
  }
}
