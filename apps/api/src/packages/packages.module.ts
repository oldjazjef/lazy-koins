import {
  type MiddlewareConsumer,
  Module,
  type NestModule,
  RequestMethod,
} from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { FilesModule } from '../files/files.module';
import { AccountPackageService } from './application/account-package.service';
import {
  ExportAccountPackageHandler,
  ExportProjectPackageHandler,
  ImportAccountPackageHandler,
  ImportProjectPackageHandler,
} from './application/packages.handlers';
import { ProjectPackageService } from './application/project-package.service';
import { PackageBodyMiddleware } from './package-body.middleware';
import { PackagesController } from './packages.controller';

/** Project packages (F10.8 = F1.3) and the account package (F10.9 = F2.3). */
@Module({
  imports: [CqrsModule, FilesModule],
  controllers: [PackagesController],
  providers: [
    ProjectPackageService,
    AccountPackageService,
    ExportProjectPackageHandler,
    ImportProjectPackageHandler,
    ExportAccountPackageHandler,
    ImportAccountPackageHandler,
  ],
})
export class PackagesModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // The two imports read the package as a raw body (larger limit than a file upload).
    consumer
      .apply(PackageBodyMiddleware)
      .forRoutes(
        { path: 'projects/import-package', method: RequestMethod.POST },
        { path: 'account/import-package', method: RequestMethod.POST },
      );
  }
}
