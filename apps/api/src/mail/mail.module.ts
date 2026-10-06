import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CqrsModule } from '@nestjs/cqrs';
import { CalculationModule } from '../calculation/calculation.module';
import { SecretBox } from '../common/crypto/secret-box';
import { type Env, mailPrivateHostsAllowed } from '../config/env';
import { ExportDataService } from '../exports/application/exports.handlers';
import { SettingsModule } from '../settings/settings.module';
import { MailGate, MailRuntime } from './application/mail-gate';
import {
  GetMailSettingsHandler,
  SaveMailSettingsHandler,
  SendTestMailHandler,
} from './application/mail-settings.handlers';
import {
  GetMailTemplateHandler,
  MailTemplates,
  PreviewMailTemplateHandler,
  ResetMailTemplateHandler,
  SaveMailTemplateHandler,
} from './application/mail-template.handlers';
import {
  ComposeMailHandler,
  ListMailLogHandler,
  SendMailHandler,
} from './application/send-mail.handlers';
import {
  MailSettingsController,
  ProjectMailController,
} from './mail.controller';
import { MailService } from './mail.service';

/**
 * Mail to the Treuhänder (F11.10, F10.6a): the user's mailer and template, composing and sending
 * from a project with stored statements attached, the send log, and the automatic F4.7 mark. SMTP
 * is reached only through `MailTransportPort` (bound in `IntegrationsModule`); the tables are
 * bound in `PersistenceModule`. `ExportDataService` is provided here too (it only reads), so the
 * exports slice stays untouched.
 */
@Module({
  imports: [CqrsModule, CalculationModule, SettingsModule],
  controllers: [MailSettingsController, ProjectMailController],
  providers: [
    MailService,
    MailGate,
    MailTemplates,
    ExportDataService,
    {
      provide: MailRuntime,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        new MailRuntime(
          new SecretBox(config.get('SETTINGS_ENCRYPTION_KEY', { infer: true })),
          mailPrivateHostsAllowed({
            MAIL_ALLOW_PRIVATE_HOSTS: config.get('MAIL_ALLOW_PRIVATE_HOSTS', {
              infer: true,
            }),
            AUTH_MODE: config.get('AUTH_MODE', { infer: true }),
          }),
        ),
    },
    GetMailSettingsHandler,
    SaveMailSettingsHandler,
    SendTestMailHandler,
    GetMailTemplateHandler,
    SaveMailTemplateHandler,
    ResetMailTemplateHandler,
    PreviewMailTemplateHandler,
    ComposeMailHandler,
    SendMailHandler,
    ListMailLogHandler,
  ],
  // The tool layer (tools/) calls the same façade as the controller.
  exports: [MailService],
})
export class MailModule {}
