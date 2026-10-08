import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { AdminController } from './admin.controller';
import { ADMIN_HANDLERS } from './application/admin.handlers';
import { PlatformAdminGuard } from './platform-admin.guard';

/** The management pages' API (`/api/admin/*`, platform admins, web only). */
@Module({
  imports: [CqrsModule],
  controllers: [AdminController],
  providers: [PlatformAdminGuard, ...ADMIN_HANDLERS],
})
export class AdminModule {}
