import { Controller, Get } from '@nestjs/common';
import { Public } from '../auth/public.decorator';
import { PrismaService } from '../prisma/prisma.service';

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  // The only operation that needs no token: Compose health checks call it (spec 001 FR-018).
  @Public()
  @Get()
  async check(): Promise<{ status: 'ok'; database: 'up' }> {
    await this.prisma.$queryRaw`SELECT 1`;
    return { status: 'ok', database: 'up' };
  }
}
