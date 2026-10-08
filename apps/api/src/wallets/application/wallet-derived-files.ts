import { createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import {
  type ManualBalance,
  networkInfo,
  walletBookingRows,
  walletBookingsCsv,
  walletHoldingsCsv,
  walletPlatform,
} from '@lazykoins/engine';
import {
  DuplicateFileException,
  storeInProject,
} from '../../files/application/commands/upload-project-file.command';
import { FileAnalysisService } from '../../files/application/file-analysis.service';
import { cleanFileName } from '../../files/domain/project-file';
import { ProjectFileRepositoryPort } from '../../files/ports/project-file.repository.port';
import { ProjectRepositoryPort } from '../../projects/ports/project.repository.port';
import { originWalletId, type Wallet, walletOrigin } from '../domain/wallet';
import { WalletRepositoryPort } from '../ports/wallet.repository.port';

/**
 * F6.3 → the existing pipeline: keeps a project's **derived standard-format files** of a wallet
 * in step with its fetched data and manual balances:
 *
 * - `<label>.wallet-buchungen.csv` — every movement on the wallet's selected networks
 *   (`walletBookingRows`: Konto = network, Referenz = transaction hash, row = movement index);
 * - `<label>.wallet-bestaende.csv` — the project's manual balances (F6.5), Beleg = evidence file.
 *
 * Both carry the origin `wallet:<walletId>`. Same content → same SHA-256 → the file stays; new
 * content → the new file is added and the old one removed (its bytes go when nothing else uses
 * them, F5.7). Closed projects are never touched (F4.5).
 *
 * F5.7a: a deactivated derived file stays deactivated — kept as it is with the same bytes, and
 * a new file that replaces it (same kind: bookings or balances) takes over its deactivation
 * (date + note). A sync never re-enables a file; only "Aktivieren" does.
 */
const DERIVED_KINDS = ['.wallet-buchungen.csv', '.wallet-bestaende.csv'];

/** Which derived file a name is (bookings or balances) — the label part may change. */
function derivedKind(name: string): string {
  return DERIVED_KINDS.find((suffix) => name.endsWith(suffix)) ?? name;
}

@Injectable()
export class WalletDerivedFiles {
  private readonly logger = new Logger(WalletDerivedFiles.name);

  constructor(
    private readonly wallets: WalletRepositoryPort,
    private readonly projects: ProjectRepositoryPort,
    private readonly files: ProjectFileRepositoryPort,
    private readonly analysis: FileAnalysisService,
  ) {}

  /** The derived files' content for a wallet in a project (empty list = no file). */
  async contentFor(
    projectId: string,
    wallet: Wallet,
  ): Promise<{ name: string; bytes: Uint8Array }[]> {
    const data = (await this.wallets.listData([wallet.id])).filter((d) =>
      wallet.networks.includes(d.network),
    );
    const overrides = await this.wallets.listOverrides(wallet.id);
    const rows = data
      .sort((a, b) =>
        a.network < b.network ? -1 : a.network > b.network ? 1 : 0,
      )
      .flatMap((d) =>
        walletBookingRows(d.movements, {
          platform: walletPlatform(wallet.label, d.network),
          accountId: d.network,
          nativeAsset: networkInfo(d.network).nativeAsset,
          notSpam: new Set(
            overrides
              .filter((o) => o.network === d.network)
              .map((o) => o.tokenKey),
          ),
        }),
      );
    const out: { name: string; bytes: Uint8Array }[] = [];
    const base = cleanFileName(wallet.label).replace(/[.\s]+$/, '') || 'wallet';
    if (rows.length > 0) {
      out.push({
        name: `${base}.wallet-buchungen.csv`,
        bytes: new TextEncoder().encode(walletBookingsCsv(rows)),
      });
    }
    const balances = await this.wallets.listBalances(projectId, wallet.id);
    if (balances.length > 0) {
      const names = new Map<string, string>();
      for (const balance of balances) {
        if (balance.evidenceFileId && !names.has(balance.evidenceFileId)) {
          const file = await this.files.findById(balance.evidenceFileId);
          names.set(balance.evidenceFileId, file?.displayName ?? '');
        }
      }
      const manual: ManualBalance[] = balances.map((b) => ({
        platform: walletPlatform(wallet.label, b.network),
        accountId: b.network,
        asset: b.asset,
        quantity: b.quantity,
        asOf: b.asOf,
        evidence: [
          b.evidenceFileId ? (names.get(b.evidenceFileId) ?? '') : '',
          b.note,
        ]
          .filter((part) => part !== '')
          .join(' · '),
      }));
      out.push({
        name: `${base}.wallet-bestaende.csv`,
        bytes: new TextEncoder().encode(walletHoldingsCsv(manual)),
      });
    }
    return out;
  }

  /** Brings the project's derived files of this wallet up to date. */
  async sync(userId: string, projectId: string, wallet: Wallet): Promise<void> {
    const project = await this.projects.findById(projectId);
    if (!project || project.ownerId !== userId || project.status === 'closed') {
      return;
    }
    const origin = walletOrigin(wallet.id);
    const existing = (await this.files.listByProject(projectId)).filter(
      (f) => f.origin === origin,
    );
    const included = (await this.wallets.listWalletIds(projectId)).includes(
      wallet.id,
    );
    const wanted = included ? await this.contentFor(projectId, wallet) : [];
    const keep = new Set<string>();
    for (const file of wanted) {
      const sha256 = createHash('sha256').update(file.bytes).digest('hex');
      const same = existing.find((f) => f.sha256 === sha256);
      if (same) {
        // Same bytes: the file stays as it is — a deactivation included (F5.7a).
        keep.add(same.id);
        continue;
      }
      try {
        const created = await storeInProject(this.files, this.analysis, {
          userId,
          projectId,
          displayName: file.name,
          kind: 'csv',
          bytes: file.bytes,
          origin,
          source: origin,
        });
        keep.add(created.id);
        // F5.7a: new bytes replacing a deactivated file of the same kind (bookings / balances)
        // stay deactivated — a fetch never re-enables what the user switched off.
        const replaced = existing.find(
          (f) =>
            f.disabledAt !== null &&
            derivedKind(f.displayName) === derivedKind(file.name),
        );
        if (replaced?.disabledAt) {
          await this.files.setDeactivation(created.id, {
            at: replaced.disabledAt,
            note: replaced.disabledNote,
          });
        }
      } catch (error) {
        // The same bytes are already in the project as another file: nothing to add.
        if (!(error instanceof DuplicateFileException)) throw error;
      }
    }
    for (const file of existing) {
      if (!keep.has(file.id)) await this.removeDerived(file.id, file.fileId);
    }
    this.logger.log(
      `project ${projectId}: wallet ${wallet.id} → ${keep.size} derived file(s)`,
    );
  }

  /** `sync` in every project that includes the wallet. */
  async syncAll(userId: string, wallet: Wallet): Promise<void> {
    for (const projectId of await this.wallets.listProjectIds(wallet.id)) {
      await this.sync(userId, projectId, wallet);
    }
  }

  /** Removes the wallet's derived files from every open project (before deleting it). */
  async removeAll(userId: string, wallet: Wallet): Promise<void> {
    const origin = walletOrigin(wallet.id);
    for (const projectId of await this.wallets.listProjectIds(wallet.id)) {
      const project = await this.projects.findById(projectId);
      if (
        !project ||
        project.ownerId !== userId ||
        project.status === 'closed'
      ) {
        continue;
      }
      for (const file of await this.files.listByProject(projectId)) {
        if (file.origin === origin) {
          await this.removeDerived(file.id, file.fileId);
        }
      }
    }
  }

  /**
   * Takes an outdated derived file out of the project; the stored copy goes too once no project
   * selects it — a wallet's old versions must not pile up among the user's files (F5.21).
   */
  private async removeDerived(
    projectFileId: string,
    storedFileId: string,
  ): Promise<void> {
    await this.files.remove(projectFileId);
    const stored = await this.files.findStored(storedFileId);
    if (
      stored &&
      stored.usages.length === 0 &&
      originWalletId(stored.source) !== undefined
    ) {
      await this.files.deleteStored(storedFileId);
    }
  }
}
