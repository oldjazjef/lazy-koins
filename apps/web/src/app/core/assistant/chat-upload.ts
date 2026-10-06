import { HttpClient } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideUpload } from '@ng-icons/lucide';
import { TranslatePipe } from '@ngx-translate/core';
import { firstValueFrom } from 'rxjs';
import { HlmButtonImports } from '@lazykoins/ui/button';
import { ActivityService } from '../activity/activity.service';
import { apiUrl } from '../api/api-url';
import type { ProjectFile } from '../api/api.types';
import {
  MAX_FILE_BYTES,
  uploadErrorKey,
} from '../../features/files/components/project-files/project-files.service';
import { AssistantEvents } from './assistant-events';
import { ChatService } from './chat.service';

interface UploadResult {
  readonly id: number;
  readonly name: string;
  readonly state: 'uploading' | 'done' | 'failed';
  /** i18n key: the file's status once read, or why it failed. */
  readonly messageKey: string | null;
  readonly fileId: string | null;
}

/**
 * "Lade die Datei hier hoch" from the assistant (F11.14): a drop zone + picker that uploads into
 * the named project exactly like the files area (raw body, `?name=`), with the result per file
 * (read as …, already in the project, failed) and a link to the file in the Dateien tab.
 */
@Component({
  selector: 'lk-chat-upload',
  imports: [RouterLink, NgIcon, TranslatePipe, ...HlmButtonImports],
  providers: [provideIcons({ lucideUpload })],
  templateUrl: './chat-upload.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChatUpload {
  private readonly http = inject(HttpClient);
  private readonly activity = inject(ActivityService);
  private readonly events = inject(AssistantEvents);
  protected readonly chat = inject(ChatService);

  readonly projectId = input.required<string>();
  readonly message = input('');

  protected readonly dragging = signal(false);
  protected readonly results = signal<readonly UploadResult[]>([]);
  private seq = 0;

  protected dragOver(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(true);
  }

  protected dragLeave(): void {
    this.dragging.set(false);
  }

  protected drop(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(false);
    const files = [...(event.dataTransfer?.files ?? [])];
    if (files.length > 0) void this.upload(files);
  }

  protected picked(event: Event): void {
    const target = event.target as HTMLInputElement;
    const files = [...(target.files ?? [])];
    target.value = '';
    if (files.length > 0) void this.upload(files);
  }

  private async upload(files: readonly File[]): Promise<void> {
    await this.activity
      .track('activity.upload', () => this.uploadAll(files), {
        params: { count: files.length },
      })
      .catch(() => undefined);
  }

  private async uploadAll(files: readonly File[]): Promise<void> {
    const projectId = this.projectId();
    let added = 0;
    for (const file of files) {
      const id = ++this.seq;
      this.results.update((list) => [
        ...list,
        {
          id,
          name: file.name,
          state: 'uploading',
          messageKey: null,
          fileId: null,
        },
      ]);
      if (file.size > MAX_FILE_BYTES) {
        this.patch(id, { state: 'failed', messageKey: 'files.upload.tooBig' });
        continue;
      }
      try {
        const stored = await firstValueFrom(
          this.http.post<ProjectFile>(
            apiUrl(`/projects/${projectId}/files`),
            file,
            {
              params: { name: file.name },
              headers: { 'Content-Type': 'application/octet-stream' },
            },
          ),
        );
        added += 1;
        this.patch(id, {
          state: 'done',
          messageKey: `files.status.${stored.status}`,
          fileId: stored.id,
        });
      } catch (error) {
        this.patch(id, { state: 'failed', messageKey: uploadErrorKey(error) });
      }
    }
    if (added > 0) this.events.changed(projectId);
  }

  private patch(id: number, changes: Partial<UploadResult>): void {
    this.results.update((list) =>
      list.map((item) => (item.id === id ? { ...item, ...changes } : item)),
    );
  }
}
