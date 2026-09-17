import 'reflect-metadata';

import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { AppModule, ProblemDetailsFilter, type Env } from '@bolsa/core';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ trustProxy: true, bodyLimit: 1_048_576 }),
    // Payment webhooks are signed over the exact bytes received, so the raw
    // body has to survive JSON parsing (spec 12.1).
    { rawBody: true },
  );

  const config = app.get(ConfigService<Env, true>);
  const isProduction = config.get('NODE_ENV', { infer: true }) === 'production';

  // Plugins register on the raw Fastify instance: each one augments the
  // FastifyInstance interface, and Nest's own register() signature cannot
  // reconcile those augmentations with each other.
  const fastify = app.getHttpAdapter().getInstance();

  // Spec 12.1: OWASP ASVS L2 headers. Caddy sets them too; doing it here keeps
  // the API safe when it is reached directly.
  await fastify.register(helmet, {
    contentSecurityPolicy: isProduction,
    crossOriginEmbedderPolicy: false,
  });

  await fastify.register(cookie, {
    secret: config.get('SESSION_SECRET', { infer: true }),
  });

  // Spec 12.1: blunt per-IP limit. Per-participant limits live in the modules
  // that know what a participant is allowed to do.
  await fastify.register(rateLimit, {
    max: 300,
    timeWindow: '1 minute',
  });

  app.enableCors({
    origin: config.get('CORS_ORIGINS', { infer: true }),
    credentials: true,
  });

  app.setGlobalPrefix('api/v1', { exclude: ['health'] });
  app.useGlobalFilters(new ProblemDetailsFilter());
  app.enableShutdownHooks();

  if (!isProduction) {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('Bolsa de Bebidas')
        .setDescription('API do mercado de bebidas em tempo real')
        .setVersion('1.0')
        .build(),
    );
    SwaggerModule.setup('api/docs', app, document);
  }

  const port = config.get('API_PORT', { infer: true });
  await app.listen({ port, host: '0.0.0.0' });
  Logger.log(`API a escutar em http://localhost:${port}`, 'Bootstrap');
}

void bootstrap();
