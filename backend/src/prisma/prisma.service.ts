import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * Spec 018 research R1 (FR-006): no query loads a ticket's entry secret unless a `select` names
 * it, so an `include: { tickets: true }` can never leak it. Typed as well as at runtime, except
 * inside `$transaction`, whose `tx` keeps the field in its types: never read `entrySecret` from
 * a default query there either.
 */
const OMIT = { ticket: { entrySecret: true } } as const;

@Injectable()
export class PrismaService
  extends PrismaClient<{ omit: typeof OMIT }>
  implements OnModuleInit, OnModuleDestroy
{
  constructor() {
    super({ omit: OMIT });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
