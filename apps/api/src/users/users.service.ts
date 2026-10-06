import { Injectable } from '@nestjs/common';
import { QueryBus } from '@nestjs/cqrs';
import { GetMeQuery } from './application/queries/get-me.query';
import type { User } from './domain/user';

/** Thin façade over the buses — no logic here; it lives in the handlers. */
@Injectable()
export class UsersService {
  constructor(private readonly queries: QueryBus) {}

  me(userId: string): Promise<User> {
    return this.queries.execute(new GetMeQuery(userId));
  }
}
