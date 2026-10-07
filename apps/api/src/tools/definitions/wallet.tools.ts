import { z } from 'zod';
import type { WalletView } from '../../wallets/application/wallet-views';
import { type AnyTool, defineTool } from '../domain/tool';
import { id, link, projectId, projectLink, type ToolServices } from './common';

const walletOut = z.object({
  id: z.string(),
  label: z.string(),
  address: z.string(),
  networks: z.array(z.string()),
  notes: z.string(),
  checkedAt: z.string().nullable(),
  projects: z.array(z.object({ id: z.string(), name: z.string() })),
  perNetwork: z.array(
    z.object({
      network: z.string(),
      selected: z.boolean(),
      used: z.boolean().nullable(),
      status: z.string(),
      fetchedAt: z.string().nullable(),
      movements: z.number(),
      spamTokens: z.number(),
      errorCode: z.string().nullable(),
    }),
  ),
  link,
});

function walletOf(wallet: WalletView) {
  return {
    id: wallet.id,
    label: wallet.label,
    address: wallet.address,
    networks: [...wallet.networks],
    notes: wallet.notes,
    checkedAt: wallet.checkedAt,
    projects: wallet.projects.map((p) => ({ id: p.id, name: p.name })),
    perNetwork: wallet.perNetwork.map((n) => ({
      network: n.network,
      selected: n.selected,
      used: n.used,
      status: n.status,
      fetchedAt: n.fetchedAt,
      movements: n.movements,
      spamTokens: n.spamTokens,
      errorCode: n.errorCode,
    })),
    link: `/app/wallets/${encodeURIComponent(wallet.id)}`,
  };
}

/** Public wallet addresses (F6). Seed phrases and private keys are refused by the service (F6.2). */
export function walletTools(s: ToolServices): AnyTool[] {
  return [
    defineTool({
      name: 'list_wallets',
      title: 'Wallets auflisten',
      description:
        "The user's wallets (public addresses only): label, networks, per network the check / last fetch, and the projects using them.",
      area: 'wallets',
      effect: 'readOnly',
      input: z.object({}),
      output: z.object({ wallets: z.array(walletOut) }),
      async run(ctx) {
        return { wallets: (await s.wallets.list(ctx.userId)).map(walletOf) };
      },
    }),
    defineTool({
      name: 'list_project_wallets',
      title: 'Wallets im Projekt',
      description:
        "The wallets included in a project with their manual balances and derived files, and the user's other wallets that could be added.",
      area: 'wallets',
      effect: 'readOnly',
      input: z.object({ projectId }),
      output: z.object({
        wallets: z.array(
          walletOut.extend({ derivedFiles: z.array(z.string()) }),
        ),
        available: z.array(
          z.object({ id: z.string(), label: z.string(), address: z.string() }),
        ),
        link,
      }),
      async run(ctx, input) {
        const overview = await s.wallets.projectWallets(
          ctx.userId,
          input.projectId,
        );
        return {
          wallets: overview.wallets.map((entry) => ({
            ...walletOf(entry.wallet),
            derivedFiles: entry.files.map((f) => f.displayName),
          })),
          available: overview.available.map((w) => ({ ...w })),
          link: projectLink(input.projectId, 'wallets'),
        };
      },
    }),
    defineTool({
      name: 'create_wallet',
      title: 'Wallet erfassen',
      description:
        'Stores a PUBLIC wallet address (or xpub/ypub/zpub) with a label. Never pass a seed phrase or private key — it is refused.',
      area: 'wallets',
      effect: 'write',
      input: z.object({
        label: z.string().trim().min(1).max(80),
        address: z.string().trim().min(1).max(200),
        networks: z.array(z.string().max(40)).max(20).optional(),
        notes: z.string().max(1000).optional(),
      }),
      output: walletOut,
      async run(ctx, input) {
        return walletOf(await s.wallets.create(ctx.userId, input));
      },
    }),
    defineTool({
      name: 'add_wallet_to_project',
      title: 'Wallet ins Projekt',
      description:
        'Includes a wallet in a project (its fetched data become files).',
      area: 'wallets',
      effect: 'write',
      input: z.object({ projectId, walletId: id('wallet') }),
      output: z.object({ added: z.boolean() }),
      async run(ctx, input) {
        await s.wallets.addToProject(
          ctx.userId,
          input.projectId,
          input.walletId,
        );
        return { added: true };
      },
    }),
    defineTool({
      name: 'remove_wallet_from_project',
      title: 'Wallet aus Projekt entfernen',
      description: 'Removes a wallet (and its derived files) from a project.',
      area: 'wallets',
      effect: 'destructive',
      input: z.object({ projectId, walletId: id('wallet') }),
      output: z.object({ removed: z.boolean() }),
      async run(ctx, input) {
        await s.wallets.removeFromProject(
          ctx.userId,
          input.projectId,
          input.walletId,
        );
        return { removed: true };
      },
    }),
    defineTool({
      name: 'check_wallet_networks',
      title: 'Netzwerke prüfen',
      description:
        'F6.4: checks on which networks the address was used (online; refused when online lookups are off).',
      area: 'wallets',
      effect: 'write',
      input: z.object({ walletId: id('wallet') }),
      output: walletOut,
      async run(ctx, input) {
        return walletOf(
          await s.wallets.checkNetworks(ctx.userId, input.walletId),
        );
      },
    }),
    defineTool({
      name: 'fetch_wallet',
      title: 'Wallet abrufen',
      description:
        'F6.3: fetches the transactions of the selected networks and refreshes the derived files of every open project using the wallet (online).',
      area: 'wallets',
      effect: 'write',
      input: z.object({ walletId: id('wallet') }),
      output: walletOut,
      async run(ctx, input) {
        return walletOf(await s.wallets.fetch(ctx.userId, input.walletId));
      },
    }),
  ];
}
