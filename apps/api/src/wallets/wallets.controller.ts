import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import {
  ApiBadGatewayResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { NETWORKS, type NetworkId } from '@lazykoins/engine';
import type { AuthenticatedUser } from '../auth/authenticated-user';
import { CurrentUser } from '../auth/current-user.decorator';
import { BEARER_SCHEME } from '../openapi/security-schemes';
import type { ChainServiceTest, ChainSettingsView } from './application/chain-settings.handlers';
import type { ProjectWalletsOverview } from './application/project-wallets.handlers';
import type { WalletView } from './application/wallet-views';
import {
  type AddressInspection,
  inspectAddress,
  type NetworkTokens,
} from './application/wallets.handlers';
import type { WalletManualBalance } from './domain/wallet';
import {
  AddProjectWalletDto,
  CreateWalletDto,
  InspectAddressDto,
  ManualBalanceDto,
  SaveChainSettingsDto,
  TestChainServiceDto,
  TokenOverrideDto,
  UpdateWalletDto,
} from './dto/wallet.dto';
import { WalletsService } from './wallets.service';

/** Lookups go to public APIs with the user's keys: a tight per-account budget. */
const LOOKUP_BUDGET = { writes: { limit: 30, ttl: 10 * 60_000 } };

const SECRET_REFUSED =
  'F6.2: a seed phrase or private key was detected and refused (`code: secretRefused`, `kind`) — the input is neither stored nor echoed';

@ApiTags('wallets')
@ApiBearerAuth(BEARER_SCHEME)
@Controller('wallets')
export class WalletsController {
  constructor(private readonly wallets: WalletsService) {}

  @Get('networks')
  @ApiOperation({ summary: 'The supported networks and what each delivers (F6.3)' })
  networks(): typeof NETWORKS {
    return NETWORKS;
  }

  @Post('inspect')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'What an address is and on which networks it can live (F6.4) — or that it is a secret (F6.2). Nothing is stored.',
  })
  inspect(@Body() dto: InspectAddressDto): AddressInspection {
    return inspectAddress(dto.address);
  }

  @Get()
  @ApiOperation({ summary: 'My wallets with network check and fetch status' })
  list(@CurrentUser() user: AuthenticatedUser): Promise<WalletView[]> {
    return this.wallets.list(user.userId);
  }

  @Post()
  @ApiOperation({ summary: 'Add a wallet (F6.1)' })
  @ApiUnprocessableEntityResponse({ description: SECRET_REFUSED })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateWalletDto,
  ): Promise<WalletView> {
    return this.wallets.create(user.userId, dto);
  }

  @Get(':id')
  @ApiOkResponse({ description: 'One wallet' })
  get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<WalletView> {
    return this.wallets.get(user.userId, id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Change label, networks, notes' })
  @ApiUnprocessableEntityResponse({ description: SECRET_REFUSED })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateWalletDto,
  ): Promise<WalletView> {
    return this.wallets.update(user.userId, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiConflictResponse({ description: 'A closed project includes the wallet' })
  delete(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.wallets.delete(user.userId, id);
  }

  @Post(':id/check-networks')
  @HttpCode(200)
  @Throttle(LOOKUP_BUDGET)
  @ApiOperation({
    summary: '"Netzwerke prüfen" (F6.4): where was the address ever used?',
  })
  @ApiConflictResponse({ description: 'Online lookups are off (F11.3)' })
  checkNetworks(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<WalletView> {
    return this.wallets.checkNetworks(user.userId, id);
  }

  @Post(':id/fetch')
  @HttpCode(200)
  @Throttle(LOOKUP_BUDGET)
  @ApiOperation({
    summary:
      '"Abrufen" (F6.3): history per selected network → derived standard files in the projects',
  })
  @ApiConflictResponse({ description: 'Online lookups are off (F11.3)' })
  fetch(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<WalletView> {
    return this.wallets.fetch(user.userId, id);
  }

  @Get(':id/tokens')
  @ApiOperation({ summary: 'Tokens per network with spam verdict (F6.6)' })
  tokens(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<NetworkTokens[]> {
    return this.wallets.tokens(user.userId, id);
  }

  @Put(':id/tokens')
  @ApiOperation({ summary: '"Kein Spam" for a token, or back to the heuristics (F6.6)' })
  setToken(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: TokenOverrideDto,
  ): Promise<NetworkTokens[]> {
    return this.wallets.setTokenOverride(
      user.userId,
      id,
      dto.network as NetworkId,
      dto.tokenKey,
      dto.notSpam,
    );
  }
}

@ApiTags('wallets')
@ApiBearerAuth(BEARER_SCHEME)
@Controller('projects/:projectId/wallets')
export class ProjectWalletsController {
  constructor(private readonly wallets: WalletsService) {}

  @Get()
  @ApiOperation({
    summary: "The project's wallets: fetch status per network, manual balances, derived files",
  })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ): Promise<ProjectWalletsOverview> {
    return this.wallets.projectWallets(user.userId, projectId);
  }

  @Post()
  @HttpCode(204)
  @ApiOperation({ summary: 'Include a wallet in the project' })
  @ApiConflictResponse({ description: 'The project is closed' })
  add(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: AddProjectWalletDto,
  ): Promise<void> {
    return this.wallets.addToProject(user.userId, projectId, dto.walletId);
  }

  @Delete(':walletId')
  @HttpCode(204)
  @ApiOperation({ summary: 'Remove a wallet (its derived files and manual balances) from the project' })
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('walletId', ParseUUIDPipe) walletId: string,
  ): Promise<void> {
    return this.wallets.removeFromProject(user.userId, projectId, walletId);
  }

  @Post(':walletId/balances')
  @ApiOperation({
    summary: 'Manual balance with a receipt (F6.5) — becomes a holding of the derived file',
  })
  addBalance(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('walletId', ParseUUIDPipe) walletId: string,
    @Body() dto: ManualBalanceDto,
  ): Promise<WalletManualBalance> {
    return this.wallets.addBalance(user.userId, projectId, walletId, dto);
  }

  @Delete(':walletId/balances/:balanceId')
  @HttpCode(204)
  removeBalance(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('walletId', ParseUUIDPipe) walletId: string,
    @Param('balanceId', ParseUUIDPipe) balanceId: string,
  ): Promise<void> {
    return this.wallets.removeBalance(
      user.userId,
      projectId,
      walletId,
      balanceId,
    );
  }
}

@ApiTags('settings')
@ApiBearerAuth(BEARER_SCHEME)
@Controller('settings/wallets')
export class WalletSettingsController {
  constructor(private readonly wallets: WalletsService) {}

  @Get()
  @ApiOperation({
    summary: 'Einstellungen › Wallets & Netzwerke (F6.7) — keys only as hints',
  })
  get(@CurrentUser() user: AuthenticatedUser): Promise<ChainSettingsView> {
    return this.wallets.settings(user.userId);
  }

  @Put()
  @ApiOperation({
    summary: 'Save keys (sealed, AES-256-GCM) and URLs; a key "" or null removes it',
  })
  @ApiUnprocessableEntityResponse({ description: 'A URL the API must not call (`code`)' })
  save(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: SaveChainSettingsDto,
  ): Promise<ChainSettingsView> {
    return this.wallets.saveSettings(user.userId, dto);
  }

  @Post('test')
  @HttpCode(200)
  @Throttle(LOOKUP_BUDGET)
  @ApiOperation({
    summary:
      '"Testen" (F6.7): one request without user data, with the form\'s unsaved values over the saved ones',
  })
  @ApiBadGatewayResponse({
    description: 'The service answered with an error: `code`, `detail`, `status`',
  })
  test(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: TestChainServiceDto,
  ): Promise<ChainServiceTest> {
    const { service, ...draft } = dto;
    return this.wallets.testService(user.userId, service, {
      etherscanKey: draft.etherscanKey ?? undefined,
      heliusKey: draft.heliusKey ?? undefined,
      subscanKey: draft.subscanKey ?? undefined,
      solanaRpcUrl: draft.solanaRpcUrl,
      esploraUrl: draft.esploraUrl,
      koiosUrl: draft.koiosUrl,
      cosmosLcdUrl: draft.cosmosLcdUrl,
    });
  }
}
