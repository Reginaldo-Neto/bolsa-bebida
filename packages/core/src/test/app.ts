import cookie from '@fastify/cookie';
import { newId, type PrismaClient } from '@bolsa/db';
import { DEFAULT_ENGINE_PARAMS, DEFAULT_EVENT_LIMITS } from '@bolsa/shared';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { AppModule } from '../app.module';
import { ProblemDetailsFilter } from '../common/problem.filter';
import {
  REDIS_PUBLISHER,
  REDIS_SUBSCRIBER,
  RedisConnections,
} from '../modules/realtime/redis.provider';
import { FakeRedisConnections } from './fake-redis';

export const TEST_SESSION_SECRET =
  process.env.SESSION_SECRET ?? 'test-session-secret-that-is-long-enough';

export async function createTestApp(): Promise<NestFastifyApplication> {
  // Realtime delivery is exercised with an in-process bus: a test should not
  // need a Redis server, and the real client retries forever by design.
  const redis = new FakeRedisConnections();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(RedisConnections)
    .useValue(redis)
    .overrideProvider(REDIS_PUBLISHER)
    .useValue(redis.publisher)
    .overrideProvider(REDIS_SUBSCRIBER)
    .useValue(redis.subscriber)
    .compile();
  const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter(), {
    rawBody: true,
  });

  const fastify = app.getHttpAdapter().getInstance();
  await fastify.register(cookie, { secret: TEST_SESSION_SECRET });

  app.setGlobalPrefix('api/v1', { exclude: ['health'] });
  app.useGlobalFilters(new ProblemDetailsFilter());

  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}

export interface SeededProduct {
  id: string;
  name: string;
  basePriceCents: number;
  stock: number;
  isAlcoholic: boolean;
}

export interface SeededEvent {
  eventId: string;
  groupId: string;
  products: SeededProduct[];
}

/** A minimal OPEN event with one substitution group. */
export async function seedEvent(
  client: PrismaClient,
  options: {
    products?: { name: string; basePriceCents: number; stock: number; isAlcoholic?: boolean }[];
    limits?: Partial<typeof DEFAULT_EVENT_LIMITS>;
    status?: 'DRAFT' | 'OPEN' | 'PAUSED' | 'CLOSED_SALES' | 'FINISHED';
  } = {},
): Promise<SeededEvent> {
  const eventId = newId();
  const groupId = newId();

  await client.event.create({
    data: {
      id: eventId,
      name: 'Festa de teste',
      status: options.status ?? 'OPEN',
      engineParams: { ...DEFAULT_ENGINE_PARAMS },
      limits: { ...DEFAULT_EVENT_LIMITS, ...options.limits },
    },
  });
  await client.productGroup.create({ data: { id: groupId, eventId, name: 'Cerveja' } });

  const definitions = options.products ?? [
    { name: 'Fino', basePriceCents: 150, stock: 100, isAlcoholic: true },
    { name: 'Cidra', basePriceCents: 200, stock: 100, isAlcoholic: true },
  ];

  const products: SeededProduct[] = [];
  for (const [index, definition] of definitions.entries()) {
    const id = newId();
    await client.product.create({
      data: {
        id,
        eventId,
        groupId,
        name: definition.name,
        isAlcoholic: definition.isAlcoholic ?? true,
        costCents: Math.floor(definition.basePriceCents / 3),
        basePriceCents: definition.basePriceCents,
        minPriceCents: Math.floor(definition.basePriceCents / 2),
        maxPriceCents: definition.basePriceCents * 2,
        stockInitial: definition.stock,
        stockAvailable: definition.stock,
        sortOrder: index,
        engineState: {
          create: {
            currentPriceCents: definition.basePriceCents,
            rawPrice: definition.basePriceCents,
          },
        },
      },
    });
    products.push({
      id,
      name: definition.name,
      basePriceCents: definition.basePriceCents,
      stock: definition.stock,
      isAlcoholic: definition.isAlcoholic ?? true,
    });
  }

  return { eventId, groupId, products };
}

/** Extracts a session cookie from a response, for use on later requests. */
export function sessionCookieFrom(
  headers: Record<string, unknown>,
  name: 'bb_session' | 'bb_staff' = 'bb_session',
): string {
  const raw = headers['set-cookie'];
  const cookies = Array.isArray(raw) ? raw : [String(raw)];
  const session = cookies.find((value) => value.startsWith(`${name}=`));
  if (!session) {
    throw new Error(`response did not set a ${name} cookie`);
  }
  return session.split(';')[0] ?? '';
}
