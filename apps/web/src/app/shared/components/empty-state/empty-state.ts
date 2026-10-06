import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/** A centred, muted message for empty lists. Pass an already-translated text. */
@Component({
  selector: 'lk-empty-state',
  template: `
    <div
      class="text-muted-foreground flex flex-col items-center gap-4 rounded-lg border border-dashed px-6 py-12 text-center text-sm"
    >
      <p>{{ message() }}</p>
      <ng-content />
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EmptyState {
  readonly message = input.required<string>();
}
