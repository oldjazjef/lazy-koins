import { Controller, Get } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { AuthenticatedUser } from '../auth/authenticated-user';
import { CurrentUser } from '../auth/current-user.decorator';
import { BEARER_SCHEME } from '../openapi/security-schemes';
import { MeResponseDto } from './dto/me-response.dto';
import { UsersService } from './users.service';

/** Everything about the signed-in user. The account is created on the first authenticated call. */
@ApiTags('me')
@ApiBearerAuth(BEARER_SCHEME)
@Controller('me')
export class MeController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @ApiOperation({ summary: 'My account (created on first sign-in)' })
  @ApiOkResponse({ type: MeResponseDto })
  async me(@CurrentUser() user: AuthenticatedUser): Promise<MeResponseDto> {
    return MeResponseDto.from(await this.users.me(user.userId));
  }
}
