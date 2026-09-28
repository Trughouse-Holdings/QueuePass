import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthGuard } from './auth.guard';
import { jwksProvider } from './jwks.provider';
import { RolesGuard } from './roles.guard';

/** Registers token validation, then role checks, on every route (Constitution V). */
@Global()
@Module({
  providers: [
    jwksProvider,
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AuthModule {}
