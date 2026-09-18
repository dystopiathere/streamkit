import { Controller, Get } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { StreamOverview } from '@streamkit/contracts';
import { type AuthenticatedUser, CurrentUser } from '../../common/auth/auth.decorators';
import { StreamService } from './stream.service';

// Жёсткий лимитер auth — только для входа и регистрации.
@SkipThrottle({ auth: true })
@Controller('stream')
export class StreamController {
  constructor(private readonly stream: StreamService) {}

  @Get()
  async overview(@CurrentUser() user: AuthenticatedUser): Promise<StreamOverview> {
    return this.stream.overview(user.id);
  }
}
