import { INestApplication, ValidationPipe } from '@nestjs/common';
import type { Request, Response } from 'express';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as swaggerUi from 'swagger-ui-express';
import { parse } from 'yaml';
import { AllExceptionsFilter } from './common/filters/prisma-exception.filter';

/** The committed contract. OPENAPI_PATH is set in the container image. */
export function contractPath(): string {
  return process.env.OPENAPI_PATH ?? join(__dirname, '../../contracts/openapi.yaml');
}

/**
 * Everything applied to the app outside the module graph. Shared by main.ts and the test app
 * so tests exercise exactly what production serves.
 */
export function configureApp(app: INestApplication): void {
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      // Surface every failing field at once rather than the first.
      stopAtFirstError: false,
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());

  // Spec 001 FR-024: only the three front ends may call the API from a browser.
  const origins = (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  app.enableCors({
    origin: origins,
    // Every method the contract uses; spec 007's layout and seating writes are PUT.
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['authorization', 'content-type'],
    credentials: false,
    // Spec 014 research R4: browsers may reuse a preflight for 10 minutes, so a rotating gallery
    // does not send one before most image reads. Origins, methods, and headers are unchanged.
    maxAge: 600,
  });

  // Spec 001 FR-027: publish the hand-written contract, never a generated copy (research R7).
  // Mounted as Express middleware, outside Nest's router, so the auth guards do not apply:
  // the documentation is public, and every API operation it describes still needs a token.
  const raw = readFileSync(contractPath(), 'utf8');
  app.use('/docs/openapi.yaml', (_req: Request, res: Response) => {
    res.type('application/yaml').send(raw);
  });
  app.use('/docs', swaggerUi.serve, swaggerUi.setup(parse(raw)));
}
