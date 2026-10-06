import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { GetMeHandler } from './application/queries/get-me.query';
import { MeController } from './me.controller';
import { UsersService } from './users.service';

/** No storage here: `UserRepositoryPort` is bound in the global `PersistenceModule`. */
@Module({
  imports: [CqrsModule],
  controllers: [MeController],
  providers: [UsersService, GetMeHandler],
})
export class UsersModule {}
