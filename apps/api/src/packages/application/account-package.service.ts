import { Injectable } from '@nestjs/common';
import { mappingFingerprint, validateMappingSpec } from '@lazykoins/engine';
import { z } from 'zod';
import { SUPPORTED_LOCALES } from '../../common/i18n/locale';
import {
  coingeckoIdsOf,
  parseCoinChoices,
} from '../../rates/domain/coin-choice';
import { ImportMappingRepositoryPort } from '../../mappings/ports/import-mapping.repository.port';
import { ProjectRepositoryPort } from '../../projects/ports/project.repository.port';
import {
  DATE_FORMATS,
  NUMBER_FORMATS,
} from '../../settings/domain/user-settings';
import { UserSettingsRepositoryPort } from '../../settings/ports/user-settings.repository.port';
import { UserRepositoryPort } from '../../users/ports/user.repository.port';
import {
  ACCOUNT_PACKAGE_EXTENSION,
  ACCOUNT_PACKAGE_FORMAT,
  buildPackage,
  jsonBytes,
  openPackage,
  PACKAGE_FORMAT_VERSION,
  PackageError,
  readJson,
  slug,
} from '../domain/package-format';
import {
  appVersion,
  canonical,
  type ImportedProject,
  ProjectPackageService,
} from './project-package.service';

const SettingsSchema = z.object({
  displayName: z.string().max(120),
  canton: z.string().regex(/^([A-Z]{2})?$/),
  advisorName: z.string().max(120),
  advisorEmail: z.string().max(200),
  /** F11.2; absent in packages from before the language setting. */
  locale: z.enum(SUPPORTED_LOCALES).optional(),
  numberFormat: z.enum(NUMBER_FORMATS),
  dateFormat: z.enum(DATE_FORMATS),
  onlineRates: z.boolean(),
  /** The older shape (CoinGecko ids only) — still written for older app versions. */
  coingeckoIds: z.record(z.string().max(40), z.string().max(100)),
  /** F7.4: symbol → { provider, id, name, symbol }; absent in older packages. */
  coinChoices: z
    .record(
      z.string().max(40),
      z.object({
        provider: z.string().max(40),
        id: z.string().max(100),
        name: z.string().max(200).nullable(),
        symbol: z.string().max(40).nullable(),
      }),
    )
    .optional(),
});

const ManifestSchema = z.object({
  format: z.literal(ACCOUNT_PACKAGE_FORMAT),
  formatVersion: z.number().int(),
  appVersion: z.string().max(40),
  createdAt: z.string().datetime({ offset: true }),
  projects: z
    .array(
      z.object({
        path: z.string(),
        name: z.string(),
        taxYear: z.number().int(),
      }),
    )
    .max(500),
  mappings: z.array(z.object({ path: z.string(), name: z.string() })).max(1000),
});

export interface ImportedAccount {
  readonly projects: readonly ImportedProject[];
  readonly mappingsCreated: number;
  readonly mappingsReused: number;
  readonly settingsApplied: boolean;
}

/**
 * F10.9 = F2.3: the account package — every project as a project package (nested, stored), all
 * mappings, the settings and the profile, **never an API key or other secret**. Import (into
 * the same or another account, later the desktop app): mappings first (reused when equal),
 * then each project package as its own transaction (a failing one stops the import; projects
 * imported before it stay); settings only when the account has none yet.
 */
@Injectable()
export class AccountPackageService {
  constructor(
    private readonly users: UserRepositoryPort,
    private readonly projects: ProjectRepositoryPort,
    private readonly mappings: ImportMappingRepositoryPort,
    private readonly settings: UserSettingsRepositoryPort,
    private readonly projectPackages: ProjectPackageService,
  ) {}

  fileName(createdAt: string): string {
    return `lazy-koins-konto-${createdAt.slice(0, 10)}${ACCOUNT_PACKAGE_EXTENSION}`;
  }

  async export(userId: string, createdAt: string): Promise<Uint8Array> {
    const user = await this.users.findById(userId);
    const files: Parameters<typeof buildPackage>[1][number][] = [];
    const projects: z.infer<typeof ManifestSchema>['projects'] = [];
    let index = 0;
    for (const project of await this.projects.findByOwner(userId)) {
      index += 1;
      const path = `projects/${String(index).padStart(3, '0')}-${slug(project.name)}-${project.taxYear}.lkproj.zip`;
      files.push({
        path,
        role: 'project',
        bytes: await this.projectPackages.export(project, createdAt),
        store: true,
      });
      projects.push({ path, name: project.name, taxYear: project.taxYear });
    }
    const mappings: z.infer<typeof ManifestSchema>['mappings'] = [];
    for (const mapping of await this.mappings.findByOwner(userId)) {
      const path = `mappings/${mapping.id}.json`;
      files.push({ path, role: 'mapping', bytes: jsonBytes(mapping.spec) });
      mappings.push({ path, name: mapping.name });
    }
    const stored = await this.settings.find(userId);
    if (stored) {
      // Secrets stay behind: no API key, sealed or not (F10.9).
      const settings: z.infer<typeof SettingsSchema> = {
        displayName: stored.displayName,
        canton: stored.canton,
        advisorName: stored.advisorName,
        advisorEmail: stored.advisorEmail,
        ...(stored.locale ? { locale: stored.locale } : {}),
        numberFormat: stored.numberFormat,
        dateFormat: stored.dateFormat,
        onlineRates: stored.onlineRates,
        coingeckoIds: coingeckoIdsOf(stored.coinChoices),
        coinChoices: Object.fromEntries(
          Object.entries(stored.coinChoices).map(([k, v]) => [k, { ...v }]),
        ),
      };
      files.push({
        path: 'settings.json',
        role: 'settings',
        bytes: jsonBytes(settings),
      });
    }
    files.push({
      path: 'profile.json',
      role: 'profile',
      bytes: jsonBytes({
        email: user?.email ?? null,
        displayName: user?.displayName ?? null,
        createdAt: user?.createdAt ?? null,
      }),
    });
    return buildPackage(
      {
        format: ACCOUNT_PACKAGE_FORMAT,
        formatVersion: PACKAGE_FORMAT_VERSION,
        appVersion: appVersion(),
        createdAt,
        projects,
        mappings,
      },
      files,
    );
  }

  async import(userId: string, bytes: Uint8Array): Promise<ImportedAccount> {
    const opened = openPackage(bytes);
    const parsed = ManifestSchema.safeParse(opened.manifest);
    if (!parsed.success) {
      throw new PackageError(
        'manifest',
        'This is not a lazy-koins account package',
      );
    }
    const manifest = parsed.data;
    if (manifest.formatVersion > PACKAGE_FORMAT_VERSION) {
      throw new PackageError(
        'version',
        `Package format ${manifest.formatVersion} is newer than this app supports`,
      );
    }
    // Validate every nested project package before writing anything.
    const nested = manifest.projects.map((p) => {
      const content = opened.files.get(p.path);
      if (!content) throw new PackageError('content', `${p.path} is missing`);
      return openPackage(content);
    });
    const specs = manifest.mappings.map((m) => {
      const validation = validateMappingSpec(
        readJson(opened, m.path, z.unknown()),
      );
      if (!validation.ok) {
        throw new PackageError('content', `${m.path} is not a valid mapping`);
      }
      return validation.spec;
    });
    const settings = opened.files.has('settings.json')
      ? readJson(opened, 'settings.json', SettingsSchema)
      : undefined;

    let mappingsCreated = 0;
    let mappingsReused = 0;
    for (const spec of specs) {
      const owned = await this.mappings.findByOwner(userId);
      const fingerprint = mappingFingerprint(spec);
      const same = owned.find(
        (o) =>
          o.fingerprint === fingerprint &&
          canonical(o.spec) === canonical(spec),
      );
      if (same) mappingsReused += 1;
      else {
        await this.mappings.create(userId, { spec, origin: 'copied' });
        mappingsCreated += 1;
      }
    }
    const projects: ImportedProject[] = [];
    for (const opened of nested) {
      projects.push(await this.projectPackages.importOpened(userId, opened));
    }
    let settingsApplied = false;
    if (settings && !(await this.settings.find(userId))) {
      const { coingeckoIds, coinChoices, ...rest } = settings;
      await this.settings.save(userId, {
        ...rest,
        // F7.4: the coin per ticker; an older package only has CoinGecko ids.
        coinChoices: parseCoinChoices(coinChoices ?? coingeckoIds),
      });
      settingsApplied = true;
    }
    return { projects, mappingsCreated, mappingsReused, settingsApplied };
  }
}
