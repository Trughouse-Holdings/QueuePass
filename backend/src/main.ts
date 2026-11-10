import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './configure-app';
import { CheckInRetention } from './entry/check-in-retention';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  configureApp(app);
  await app.listen(process.env.PORT ?? 3000, '0.0.0.0');
  // Spec 032 FR-006, SC-007 (research R5): the one call that starts the check-in retention job,
  // in the Backend that serves the API only, never in the demo data or demo reset commands.
  app.get(CheckInRetention).start();
}

void bootstrap();
