import { Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { AuthModule } from './auth/auth.module';
import { PrismaModule } from './prisma/prisma.module';
import { HealthModule } from './health/health.module';
import { MeModule } from './me/me.module';
import { HelloModule } from './hello/hello.module';
import { LocationsModule } from './locations/locations.module';
import { EventsModule } from './events/events.module';
import { TiersModule } from './tiers/tiers.module';
import { OrdersModule } from './orders/orders.module';
import { ReportsModule } from './reports/reports.module';
import { SeatingModule } from './seating/seating.module';

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
    TiersModule,
    OrdersModule,
    ReportsModule,
    SeatingModule,
  ],
})
export class AppModule {}
