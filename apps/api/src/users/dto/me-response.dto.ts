import { ApiProperty } from '@nestjs/swagger';
import type { User } from '../domain/user';

export class MeResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() email!: string;
  @ApiProperty() displayName!: string;
  @ApiProperty({
    description:
      'How the identity was proven: google.com, password, dev, local',
  })
  signInProvider!: string;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;

  static from(user: User): MeResponseDto {
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      signInProvider: user.signInProvider,
      createdAt: user.createdAt,
    };
  }
}
