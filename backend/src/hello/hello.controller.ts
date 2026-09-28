import { Controller, Get } from '@nestjs/common';
import { CurrentPrincipal, type Principal } from '../auth/principal';
import { Roles } from '../auth/roles.decorator';

export interface Hello {
  app: 'admin' | 'customer' | 'booth';
  appName: string;
  username: string;
  message: string;
}

const greet = (app: Hello['app'], appName: string, { username }: Principal): Hello => ({
  app,
  appName,
  username,
  message: `Hello, ${username}! Welcome to ${appName}.`,
});

/**
 * Spec 001 FR-023: one greeting per front end, each restricted to that front end's role. The
 * hello-world pages call these to prove they reached the Backend with the user's own token.
 */
@Controller('hello')
export class HelloController {
  @Get('admin')
  @Roles('queuepass-admin')
  admin(@CurrentPrincipal() p: Principal): Hello {
    return greet('admin', 'QueuePass Admin', p);
  }

  @Get('customer')
  @Roles('customer')
  customer(@CurrentPrincipal() p: Principal): Hello {
    return greet('customer', 'QueuePass', p);
  }

  @Get('booth')
  @Roles('gate-agent')
  booth(@CurrentPrincipal() p: Principal): Hello {
    return greet('booth', 'QueuePass Ticket Booth', p);
  }
}
