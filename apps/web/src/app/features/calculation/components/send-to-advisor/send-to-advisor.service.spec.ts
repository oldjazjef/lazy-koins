import { provideHttpClient, withInterceptors } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';
import type {
  MailComposition,
  ProjectSentStatus,
} from '../../../../core/api/mail.types';
import { NotificationService } from '../../../../core/notifications/notification.service';
import { DataChanges } from '../../../../core/data/data-changes';
import { dataChangesInterceptor } from '../../../../core/data/data-changes.interceptor';
import {
  mailtoLink,
  selectedBytes,
  SendToAdvisorService,
} from './send-to-advisor.service';

const composition = (over: Partial<MailComposition> = {}): MailComposition => ({
  mailerReady: true,
  to: 'treuhand@example.ch',
  advisorName: 'Treuhand AG',
  ownAddress: 'anna@lazykoins.dev',
  subject: 'Steuern 2025',
  body: 'Guten Tag',
  unknownPlaceholders: [],
  attachments: [
    {
      id: 'e1',
      kind: 'simple_pdf',
      fileName: 'a.pdf',
      size: 1000,
      createdAt: '2026-10-01T10:00:00.000Z',
      internal: false,
      selected: true,
    },
    {
      id: 'e2',
      kind: 'internal_report_pdf',
      fileName: 'intern.pdf',
      size: 500,
      createdAt: '2026-10-01T10:00:00.000Z',
      internal: true,
      selected: false,
    },
  ],
  maxAttachmentBytes: 20 * 1024 * 1024,
  calculated: true,
  ...over,
});

const notSent: ProjectSentStatus = { sent: null, changes: [] };
const sentStatus: ProjectSentStatus = {
  sent: {
    sentAt: '2026-10-06T10:00:00.000Z',
    sentTo: 'treuhand@example.ch',
    via: 'mail',
    note: '',
    exportIds: ['e1'],
    mailLogId: 'm1',
  },
  changes: [],
};

const settle = async () => {
  await new Promise((resolve) => setTimeout(resolve));
  TestBed.tick();
  await new Promise((resolve) => setTimeout(resolve));
};

async function setup() {
  const notifications = { success: vi.fn(), error: vi.fn(), info: vi.fn() };
  TestBed.configureTestingModule({
    providers: [
      // The app's DataChanges interceptor: a send/mark reports a change to the project.
      provideHttpClient(withInterceptors([dataChangesInterceptor])),
      provideHttpClientTesting(),
      provideTranslateService(),
      SendToAdvisorService,
      { provide: NotificationService, useValue: notifications },
    ],
  });
  const service = TestBed.inject(SendToAdvisorService);
  const http = TestBed.inject(HttpTestingController);
  const events = TestBed.inject(DataChanges);
  service.projectId.set('p1');
  await settle();
  http.expectOne('/api/projects/p1/mail/log').flush([]);
  http.expectOne('/api/projects/p1/sent').flush(notSent);
  await settle();
  return { service, http, events, notifications };
}

/** After a change the log and the sent state load again. */
async function reloads(http: HttpTestingController, sent = sentStatus) {
  await settle();
  for (const request of http.match('/api/projects/p1/mail/log')) {
    request.flush([]);
  }
  for (const request of http.match('/api/projects/p1/sent')) {
    request.flush(sent);
  }
}

describe('SendToAdvisorService', () => {
  afterEach(() => {
    try {
      TestBed.inject(HttpTestingController).verify();
    } finally {
      TestBed.resetTestingModule();
    }
  });

  it('opens with the composed mail and recomposes for another selection', async () => {
    const { service, http } = await setup();
    const opened = service.open();
    const request = http.expectOne('/api/projects/p1/mail/compose');
    expect(request.request.body).toEqual({});
    request.flush(composition());
    expect(await opened).toBe(true);
    expect(service.composition()?.to).toBe('treuhand@example.ch');

    const again = service.compose(['e2']);
    const second = http.expectOne('/api/projects/p1/mail/compose');
    expect(second.request.body).toEqual({ exportIds: ['e2'] });
    second.flush(composition({ body: '- intern.pdf' }));
    expect((await again).body).toBe('- intern.pdf');
  });

  it('sends the confirmed mail, sets F4.7 and tells the project page', async () => {
    const { service, http, events, notifications } = await setup();
    service.composition.set(composition());
    const before = events.projectVersion('p1');
    const sent = service.send({
      to: 'treuhand@example.ch',
      ccMe: true,
      subject: 'S',
      body: 'B',
      exportIds: ['e1'],
      confirmed: true,
    });
    const request = http.expectOne('/api/projects/p1/mail/send');
    expect(request.request.body).toMatchObject({
      confirmed: true,
      exportIds: ['e1'],
    });
    request.flush({
      log: {
        id: 'm1',
        to: 'treuhand@example.ch',
        cc: 'anna@lazykoins.dev',
        subject: 'S',
        attachments: [],
        status: 'sent',
        error: null,
        createdAt: '2026-10-06T10:00:00.000Z',
      },
      sent: sentStatus,
    });
    expect(await sent).toBe(true);
    expect(service.composition()).toBeNull();
    expect(events.projectVersion('p1')).toBe(before + 1);
    expect(notifications.success).toHaveBeenCalledWith('mail.send.sent');
    await reloads(http);
    await settle();
    expect(service.isSent()).toBe(true);
  });

  it('keeps the dialog open with the SMTP details when sending fails', async () => {
    const { service, http, notifications } = await setup();
    service.composition.set(composition());
    const sent = service.send({
      to: 'treuhand@example.ch',
      ccMe: false,
      subject: 'S',
      body: 'B',
      exportIds: [],
      confirmed: true,
    });
    http.expectOne('/api/projects/p1/mail/send').flush(
      {
        code: 'smtpFailed',
        smtp: {
          kind: 'connection',
          host: 'smtp.example.ch',
          port: 587,
          smtpCode: null,
          response: 'connect ECONNREFUSED',
          command: 'CONN',
          code: 'ESOCKET',
        },
      },
      { status: 502, statusText: 'Bad Gateway' },
    );
    expect(await sent).toBe(false);
    expect(service.composition()).not.toBeNull();
    expect(service.sendError()?.kind).toBe('connection');
    expect(notifications.error).toHaveBeenCalledWith('mail.errors.smtpFailed');
    await reloads(http, notSent);
  });

  it('marks as sent by hand and undoes it', async () => {
    const { service, http } = await setup();
    const marked = service.markSent({
      date: '2026-10-05',
      via: 'post',
      note: 'eingeschrieben',
      to: '',
      exportIds: ['e1'],
    });
    const put = http.expectOne('/api/projects/p1/sent');
    expect(put.request.method).toBe('PUT');
    put.flush({ ...sentStatus, sent: { ...sentStatus.sent, via: 'post' } });
    expect(await marked).toBe(true);
    await reloads(http);

    const undone = service.undoSent();
    const del = http.expectOne('/api/projects/p1/sent');
    expect(del.request.method).toBe('DELETE');
    del.flush(notSent);
    expect(await undone).toBe(true);
    await reloads(http, notSent);
    await settle();
    expect(service.isSent()).toBe(false);
  });
});

describe('send-to-advisor helpers', () => {
  it('builds the mailto link and sums the selected attachments', () => {
    expect(mailtoLink('treuhand@example.ch', 'Steuern 2025', 'A\nB & C')).toBe(
      'mailto:treuhand@example.ch?subject=Steuern%202025&body=A%0AB%20%26%20C',
    );
    expect(selectedBytes(composition())).toBe(1000);
  });
});
