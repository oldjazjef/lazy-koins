import { NotFoundException } from '@nestjs/common';
import { type IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import type { User } from '../../domain/user';
import { UserRepositoryPort } from '../../ports/user.repository.port';

export class GetMeQuery {
  constructor(readonly userId: string) {}
}

@QueryHandler(GetMeQuery)
export class GetMeHandler implements IQueryHandler<GetMeQuery, User> {
  constructor(private readonly users: UserRepositoryPort) {}

  async execute({ userId }: GetMeQuery): Promise<User> {
    const user = await this.users.findById(userId);
    if (!user) throw new NotFoundException('No such user');
    return user;
  }
}
