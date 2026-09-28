import { Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { AuthModule } from './auth/auth.module';
import { PrismaModule } from './prisma/prisma.module';
import { HealthModule } from './health/health.module';
import { MeModule } from './me/me.module';
import { HelloModule } from './hello/hello.module';
import { LocationsModule } from './locations/locations.module';
import { EventsModule } from './events/events.module';

@Module({
  imports: [
    // DiscoveryModule lets the contract route-coverage test enumerate controllers.
    DiscoveryModule,
    AuthModule,
    PrismaModule,
    HealthModule,
    MeModule,
    HelloModule,
    LocationsModule,
    EventsModule,
  ],
})
export class AppModule {}
