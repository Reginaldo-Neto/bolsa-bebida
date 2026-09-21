import 'reflect-metadata';

import { AppModule, AuthService, PrismaService } from '@bolsa/core';
import { staffRoleSchema } from '@bolsa/shared';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { URI, TOTP } from 'otpauth';

/**
 * Adds a bar, till or admin account to an event that already exists.
 *
 * The setup command creates an event with one of each. A party needs more than
 * that — a second bar, a second till, someone who arrives at midnight — and
 * recreating the event to add them would throw away the evening's sales.
 *
 * Run with:
 *   STAFF_EVENT_ID=<id> STAFF_EMAIL=caixa2@festa.pt STAFF_PASSWORD=<...> \
 *   STAFF_ROLE=CASHIER pnpm --filter @bolsa/api staff:create
 *
 * It goes through the real AuthService, so the password hashing and the TOTP
 * secret are produced exactly as they are in production.
 */
async function main(): Promise<void> {
  const eventId = required('STAFF_EVENT_ID');
  const email = required('STAFF_EMAIL').toLowerCase();
  const password = required('STAFF_PASSWORD');
  const role = staffRoleSchema.parse(process.env.STAFF_ROLE ?? 'STAFF');
  const pickupPoint = process.env.STAFF_PICKUP_POINT ?? null;

  if (password.length < 12) {
    throw new Error('STAFF_PASSWORD: pelo menos 12 caracteres.');
  }

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const prisma = app.get(PrismaService).client;

  const event = await prisma.event.findUnique({ where: { id: eventId }, select: { name: true } });
  if (!event) {
    throw new Error(`Evento ${eventId} nao existe.`);
  }

  const existing = await prisma.staffUser.findUnique({
    where: { eventId_email: { eventId, email } },
    select: { id: true },
  });
  if (existing) {
    throw new Error(`${email} ja tem conta neste evento.`);
  }

  const created = await app.get(AuthService).createUser({
    eventId,
    email,
    password,
    role,
    pickupPoint,
  });

  console.log('');
  console.log(`Conta ${role} criada em "${event.name}":`);
  console.log(`  ${email} / ${password}`);

  if (created.totpSecret) {
    const otpauth = URI.stringify(
      new TOTP({ issuer: 'Bolsa de Bebidas', label: email, secret: created.totpSecret }),
    );
    console.log('');
    console.log('2FA obrigatorio para administradores. Este segredo so aparece agora:');
    console.log(`  Segredo:  ${created.totpSecret}`);
    console.log(`  otpauth:  ${otpauth}`);
  }
  console.log('');

  await app.close();
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Falta a variavel ${name}.`);
  }
  return value;
}

main().catch((error: unknown) => {
  Logger.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
