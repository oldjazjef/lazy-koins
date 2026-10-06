import {
  ChangeDetectionStrategy,
  Component,
  input,
  model,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslatePipe } from '@ngx-translate/core';
import { HlmInputImports } from '@lazykoins/ui/input';
import { HlmTextareaImports } from '@lazykoins/ui/textarea';
import type { MappingPreview, SpecIssue } from '../../../../core/api/api.types';
import { MappingPreviewView } from '../mapping-preview';

/** A file a spec can be checked against (any project of mine). */
export interface CheckFileOption {
  readonly id: string;
  readonly label: string;
}

/**
 * The body of the mapping editor: the JSON, its issues (from the API's schema validation), the
 * file to check it against and the preview. Purely presentational — the buttons (check, save)
 * belong to the host, in a dialog footer or under the page's card. Used by the project's "new
 * mapping for this file" dialog and the global mapping page (F11.0).
 */
@Component({
  selector: 'lk-mapping-editor-form',
  imports: [
    FormsModule,
    TranslatePipe,
    MappingPreviewView,
    ...HlmInputImports,
    ...HlmTextareaImports,
  ],
  host: { class: 'block' },
  template: `
    <div class="grid gap-4 lg:grid-cols-2">
      <div class="flex flex-col gap-2">
        <label class="text-sm font-medium" [for]="idPrefix() + '-json'">{{
          'mappings.editor.json' | translate
        }}</label>
        <textarea
          hlmTextarea
          class="min-h-96 font-mono text-xs"
          spellcheck="false"
          [id]="idPrefix() + '-json'"
          [ngModel]="text()"
          (ngModelChange)="text.set($event)"
        ></textarea>
        @if (invalidJson()) {
          <p class="text-destructive text-sm">
            {{ 'mappings.editor.invalidJson' | translate }}
          </p>
        }
        @if (issues().length > 0) {
          <div class="text-destructive text-sm">
            <p class="font-medium">
              {{ 'mappings.editor.issues' | translate }}
            </p>
            <ul class="list-disc pl-5">
              @for (issue of issues(); track $index) {
                <li class="font-mono text-xs">
                  {{ issue.path || '/' }}: {{ issue.message }}
                </li>
              }
            </ul>
          </div>
        }
      </div>
      <div class="flex min-w-0 flex-col gap-2">
        @if (checkFiles().length > 0) {
          <label class="text-sm font-medium" [for]="idPrefix() + '-file'">{{
            'mappings.editor.checkFile' | translate
          }}</label>
          <select
            hlmInput
            [id]="idPrefix() + '-file'"
            [ngModel]="checkFileId()"
            (ngModelChange)="checkFileId.set($event)"
          >
            @for (file of checkFiles(); track file.id) {
              <option [value]="file.id">{{ file.label }}</option>
            }
          </select>
          @if (preview(); as current) {
            <lk-mapping-preview [preview]="current" />
          } @else {
            <p class="text-muted-foreground text-sm">
              {{ 'mappings.editor.checkHint' | translate }}
            </p>
          }
        } @else {
          <p class="text-muted-foreground text-sm">
            {{ 'mappings.editor.noCheckFile' | translate }}
          </p>
        }
      </div>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MappingEditorForm {
  /** The spec as JSON text. */
  readonly text = model.required<string>();
  readonly checkFileId = model.required<string>();
  readonly checkFiles = input.required<readonly CheckFileOption[]>();
  readonly issues = input<readonly SpecIssue[]>([]);
  readonly invalidJson = input(false);
  readonly preview = input<MappingPreview | null>(null);
  /** Prefix of the element ids (label targets). */
  readonly idPrefix = input('mapping');
}
