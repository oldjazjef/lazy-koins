import { NotFoundException } from '@nestjs/common';
import type { Wallet } from '../domain/wallet';
import type { WalletRepositoryPort } from '../ports/wallet.repository.port';

/** The wallet, if `userId` owns it — someone else's wallet reads as missing (404). */
export async function loadOwnWallet(
  wallets: WalletRepositoryPort,
  userId: string,
  walletId: string,
): Promise<Wallet> {
  const wallet = await wallets.findById(walletId);
  if (!wallet || wallet.ownerId !== userId) {
    throw new NotFoundException('No such wallet');
  }
  return wallet;
}
