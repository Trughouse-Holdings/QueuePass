import { Controller, Get } from '@nestjs/common';
import { CurrentPrincipal, type Principal } from '../auth/principal';

/** Spec 001 FR-022: who the caller is, read only from the validated token. */
@Controller('me')
export class MeController {
  @Get()
  me(@CurrentPrincipal() principal: Principal): Pick<Principal, 'sub' | 'username' | 'roles'> {
    return { sub: principal.sub, username: principal.username, roles: principal.roles };
  }
}
