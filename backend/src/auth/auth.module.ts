import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AttemptLimitGuard } from '../attempt-limits/attempt-limit.guard';
import { AttemptLimitsModule } from '../attempt-limits/attempt-limits.module';
import { AuthGuard } from './auth.guard';
import { jwksProvider } from './jwks.provider';
import { RolesGuard } from './roles.guard';

/**
 * Registers token validation, then role checks, then the attempt limits, on every route
 * (Constitution V; spec 026 research R1). Nest runs global guards in this order, and it is the
 * order of refusals (spec 026 FR-009): not signed in (401), not allowed (403), then too many tries
 * (429), each before any pipe or handler.
 */
@Global()
@Module({
  imports: [AttemptLimitsModule],
  providers: [
    jwksProvider,
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: AttemptLimitGuard },
  ],
})
export class AuthModule {}
