import { LkDatePipe } from '../../../../shared/format/date.pipe';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import {
  FormBuilder,
  type FormControl,
  type FormGroup,
  ReactiveFormsModule,
} from '@angular/forms';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideBan, lucideCopy, lucidePlus } from '@ng-icons/lucide';
import { TranslatePipe } from '@ngx-translate/core';
import { HlmBadgeImports } from '@lazykoins/ui/badge';
import { HlmButtonImports } from '@lazykoins/ui/button';
import { HlmCardImports } from '@lazykoins/ui/card';
import { HlmDialogImports } from '@lazykoins/ui/dialog';
import { HlmInputImports } from '@lazykoins/ui/input';
import { HlmLabelImports } from '@lazykoins/ui/label';
import { HlmSkeletonImports } from '@lazykoins/ui/skeleton';
import { HlmTableImports } from '@lazykoins/ui/table';
import { z } from 'zod';
import {
  AUDIT_SOURCES,
  MCP_AREAS,
  TOKEN_EXPIRIES,
  type AuditSource,
  type McpArea,
  type McpSettings,
  type McpTool,
  type McpToken,
  type TokenExpiry,
  type ToolEffect,
} from '../../../../core/api/assistant.types';
import { LanguageService } from '../../../../core/i18n/language.service';
import { EmptyState } from '../../../../shared/components/empty-state';
import { PageHeader } from '../../../../shared/components/page-header';
import { paginate, Paginator } from '../../../../shared/components/paginator';
import {
  type RowAction,
  RowActions,
} from '../../../../shared/components/row-actions';
import { Truncate } from '../../../../shared/components/truncate';
import { zodValidator } from '../../../../shared/forms/zod-validator';
import { McpSettingsPageService } from './mcp-settings-page.service';

const TokenSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'mcp.tokens.nameRequired')
    .max(80, 'mcp.tokens.nameTooLong'),
  expiry: z.enum(TOKEN_EXPIRIES),
});

type Dialog =
  | { readonly kind: 'create' }
  | { readonly kind: 'created' }
  | { readonly kind: 'revoke'; readonly token: McpToken };

type AreaControls = Record<McpArea, FormControl<boolean>>;

const EFFECT_VARIANTS: Record<
  ToolEffect,
  'outline' | 'secondary' | 'destructive'
> = {
  readOnly: 'outline',
  write: 'secondary',
  destructive: 'destructive',
};

/**
 * Einstellungen › MCP (F11.16): lets AI clients (Claude Desktop, Claude Code, …) use the app's
 * tools — off by default, per area, writing only when allowed — with tokens, ready-made client
 * configurations, the tool list and the log of every call.
 */
@Component({
  selector: 'lk-mcp-settings-page',
  imports: [
    LkDatePipe,
    ReactiveFormsModule,
    NgIcon,
    TranslatePipe,
    PageHeader,
    EmptyState,
    Paginator,
    RowActions,
    Truncate,
    ...HlmBadgeImports,
    ...HlmButtonImports,
    ...HlmCardImports,
    ...HlmDialogImports,
    ...HlmInputImports,
    ...HlmLabelImports,
    ...HlmSkeletonImports,
    ...HlmTableImports,
  ],
  providers: [McpSettingsPageService, provideIcons({ lucideCopy, lucidePlus })],
  templateUrl: './mcp-settings-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class McpSettingsPage {
  protected readonly service = inject(McpSettingsPageService);
  /** F11.2: tool titles in the app's language. */
  protected readonly language = inject(LanguageService);
  private readonly fb = inject(FormBuilder).nonNullable;
  protected readonly areas = MCP_AREAS;
  protected readonly sources = AUDIT_SOURCES;
  protected readonly expiries = TOKEN_EXPIRIES;
  protected readonly effectVariants = EFFECT_VARIANTS;

  protected readonly form = this.fb.group({
    enabled: [false],
    allowWrite: [false],
    areas: this.fb.group(
      Object.fromEntries(
        MCP_AREAS.map((area) => [area, this.fb.control(false)]),
      ) as AreaControls,
    ) as FormGroup<AreaControls>,
  });

  protected readonly tokenForm = this.fb.group(
    { name: [''], expiry: ['90' as TokenExpiry] },
    { validators: zodValidator(TokenSchema) },
  );

  protected readonly dialog = signal<Dialog | null>(null);

  protected readonly current = computed<McpSettings | undefined>(() =>
    this.service.settings.hasValue()
      ? this.service.settings.value()
      : undefined,
  );

  /** The tools by area, in the order of the areas. */
  protected readonly toolGroups = computed(() => {
    const tools = this.current()?.tools ?? [];
    return MCP_AREAS.map((area) => ({
      area,
      tools: tools.filter((tool: McpTool) => tool.area === area),
    })).filter((group) => group.tools.length > 0);
  });

  private readonly tokenRows = computed(() =>
    this.service.tokens.hasValue() ? this.service.tokens.value() : [],
  );
  protected readonly tokenPager = paginate(this.tokenRows, {
    storageKey: 'mcp-tokens',
  });
  /** One action per token: revoke, offered while it is active. */
  protected readonly tokenActions = computed(
    () =>
      new Map(
        this.tokenRows().map(
          (token) =>
            [
              token.id,
              [
                {
                  id: 'revoke',
                  labelKey: 'mcp.tokens.revoke',
                  icon: lucideBan,
                  danger: true,
                  hidden: token.state !== 'active',
                },
              ] satisfies RowAction[],
            ] as const,
        ),
      ),
  );

  private readonly auditRows = computed(() =>
    this.service.audit.hasValue() ? this.service.audit.value() : [],
  );
  protected readonly auditPager = paginate(this.auditRows, {
    storageKey: 'mcp-audit',
    resetOn: () => this.service.auditSource(),
  });

  constructor() {
    effect(() => {
      const settings = this.current();
      if (settings && this.form.pristine) this.fill(settings);
    });
    void this.service.loadStdio();
  }

  protected async save(): Promise<void> {
    const { enabled, allowWrite, areas } = this.form.getRawValue();
    const saved = await this.service.save({
      enabled,
      allowWrite,
      areas: MCP_AREAS.filter((area) => areas[area]),
    });
    if (saved) {
      this.form.markAsPristine();
      const settings = this.current();
      if (settings) this.fill(settings);
    }
  }

  protected setSource(value: string): void {
    this.service.auditSource.set(
      (AUDIT_SOURCES as readonly string[]).includes(value)
        ? (value as AuditSource)
        : '',
    );
  }

  protected openCreate(): void {
    this.tokenForm.reset({ name: '', expiry: '90' });
    this.dialog.set({ kind: 'create' });
  }

  protected async create(): Promise<void> {
    this.tokenForm.markAllAsTouched();
    const parsed = TokenSchema.safeParse(this.tokenForm.getRawValue());
    if (!parsed.success) return;
    const created = await this.service.createToken({
      name: parsed.data.name,
      expiresInDays:
        parsed.data.expiry === 'never' ? null : Number(parsed.data.expiry),
    });
    if (created) this.dialog.set({ kind: 'created' });
  }

  protected readonly revokeTarget = computed(() => {
    const dialog = this.dialog();
    return dialog?.kind === 'revoke' ? dialog.token : null;
  });

  protected revokePending(): void {
    const token = this.revokeTarget();
    if (token) void this.revoke(token);
  }

  protected tokenAction(token: McpToken): void {
    this.dialog.set({ kind: 'revoke', token });
  }

  protected async revoke(token: McpToken): Promise<void> {
    this.dialog.set(null);
    await this.service.revokeToken(token);
  }

  protected dialogState(): 'open' | 'closed' {
    return this.dialog() ? 'open' : 'closed';
  }

  protected dialogChanged(state: 'open' | 'closed'): void {
    if (state === 'closed') this.dialog.set(null);
  }

  private fill(settings: McpSettings): void {
    this.form.reset(
      {
        enabled: settings.enabled,
        allowWrite: settings.allowWrite,
        areas: Object.fromEntries(
          MCP_AREAS.map((area) => [area, settings.areas.includes(area)]),
        ) as Record<McpArea, boolean>,
      },
      { emitEvent: false },
    );
  }
}
