import 'reflect-metadata';

import { AppModule, AuthService, PrismaService } from '@bolsa/core';
import { newId } from '@bolsa/db';
import { DEFAULT_ENGINE_PARAMS, DEFAULT_EVENT_LIMITS } from '@bolsa/shared';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { URI, TOTP } from 'otpauth';

/**
 * Creates an event with a catalogue, an administrator, a bar account and a
 * till account, then prints everything needed to try the product.
 *
 * Run with: pnpm --filter @bolsa/api event:create
 *
 * It goes through the real AuthService rather than writing rows directly, so
 * the password hashing and the TOTP secret are produced exactly as they are in
 * production.
 */
interface SeedProduct {
  name: string;
  category: string;
  isAlcoholic: boolean;
  volumeMl: number;
  costCents: number;
  basePriceCents: number;
  minPriceCents: number;
  maxPriceCents: number;
  stock: number;
}

const CATALOG: { group: string; products: SeedProduct[] }[] = [
  {
    group: 'Cerveja e cidra',
    products: [
      {
        name: 'Fino',
        category: 'Cerveja',
        isAlcoholic: true,
        volumeMl: 200,
        costCents: 60,
        basePriceCents: 150,
        minPriceCents: 100,
        maxPriceCents: 250,
        stock: 600,
      },
      {
        name: 'Imperial',
        category: 'Cerveja',
        isAlcoholic: true,
        volumeMl: 330,
        costCents: 70,
        basePriceCents: 150,
        minPriceCents: 100,
        maxPriceCents: 250,
        stock: 400,
      },
      {
        name: 'Cidra',
        category: 'Cerveja',
        isAlcoholic: true,
        volumeMl: 330,
        costCents: 90,
        basePriceCents: 200,
        minPriceCents: 150,
        maxPriceCents: 300,
        stock: 250,
      },
    ],
  },
  {
    group: 'Cocktails',
    products: [
      {
        name: 'Sangria',
        category: 'Cocktail',
        isAlcoholic: true,
        volumeMl: 300,
        costCents: 150,
        basePriceCents: 350,
        minPriceCents: 250,
        maxPriceCents: 500,
        stock: 200,
      },
      {
        name: 'Gin tonico',
        category: 'Cocktail',
        isAlcoholic: true,
        volumeMl: 300,
        costCents: 200,
        basePriceCents: 450,
        minPriceCents: 350,
        maxPriceCents: 650,
        stock: 200,
      },
    ],
  },
  {
    group: 'Sem alcool',
    products: [
      {
        name: 'Sumo',
        category: 'Sem alcool',
        isAlcoholic: false,
        volumeMl: 250,
        costCents: 50,
        basePriceCents: 150,
        minPriceCents: 100,
        maxPriceCents: 200,
        stock: 300,
      },
      // L8: water is always on the market.
      {
        name: 'Agua',
        category: 'Sem alcool',
        isAlcoholic: false,
        volumeMl: 500,
        costCents: 20,
        basePriceCents: 100,
        minPriceCents: 50,
        maxPriceCents: 100,
        stock: 800,
      },
    ],
  },
];

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const prisma = app.get(PrismaService).client;
  const auth = app.get(AuthService);

  const adminPassword = process.env.SETUP_ADMIN_PASSWORD ?? 'admin-da-festa-2026';
  const staffPassword = process.env.SETUP_STAFF_PASSWORD ?? 'bar-da-festa-2026';
  const cashierPassword = process.env.SETUP_CASHIER_PASSWORD ?? 'caixa-da-festa-2026';
  const eventName = process.env.SETUP_EVENT_NAME ?? 'Festa de teste';

  const eventId = newId();
  await prisma.event.create({
    data: {
      id: eventId,
      name: eventName,
      // Open straight away so the market is usable without another step.
      status: 'OPEN',
      engineParams: { ...DEFAULT_ENGINE_PARAMS },
      limits: { ...DEFAULT_EVENT_LIMITS },
    },
  });

  let sortOrder = 0;
  for (const entry of CATALOG) {
    const groupId = newId();
    await prisma.productGroup.create({ data: { id: groupId, eventId, name: entry.group } });

    for (const product of entry.products) {
      sortOrder += 1;
      await prisma.product.create({
        data: {
          id: newId(),
          eventId,
          groupId,
          name: product.name,
          category: product.category,
          isAlcoholic: product.isAlcoholic,
          volumeMl: product.volumeMl,
          costCents: product.costCents,
          basePriceCents: product.basePriceCents,
          minPriceCents: product.minPriceCents,
          maxPriceCents: product.maxPriceCents,
          stockInitial: product.stock,
          stockAvailable: product.stock,
          sortOrder,
          engineState: {
            create: {
              currentPriceCents: product.basePriceCents,
              rawPrice: product.basePriceCents,
            },
          },
        },
      });
    }
  }

  const admin = await auth.createUser({
    eventId,
    email: 'admin@festa.pt',
    password: adminPassword,
    role: 'ADMIN',
  });
  await auth.createUser({
    eventId,
    email: 'bar@festa.pt',
    password: staffPassword,
    role: 'STAFF',
    pickupPoint: 'Bar principal',
  });
  // Sells to whoever pays in notes or on the bar's own card terminal.
  await auth.createUser({
    eventId,
    email: 'caixa@festa.pt',
    password: cashierPassword,
    role: 'CASHIER',
    pickupPoint: 'Bar principal',
  });

  const web = process.env.SETUP_WEB_URL ?? 'http://localhost:5173';
  const otpauth = URI.stringify(
    new TOTP({
      issuer: 'Bolsa de Bebidas',
      label: 'admin@festa.pt',
      secret: admin.totpSecret ?? '',
    }),
  );

  console.log('');
  console.log('='.repeat(70));
  console.log(`Evento criado: ${eventName}`);
  console.log(`ID do evento:  ${eventId}`);
  console.log(`${sortOrder} bebidas em ${CATALOG.length} grupos de substituicao.`);
  console.log('');
  console.log('Enderecos:');
  console.log(`  Participante  ${web}/e/${eventId}`);
  console.log(`  Bar (staff)   ${web}/staff`);
  console.log(`  Caixa         ${web}/caixa`);
  console.log(`  Administracao ${web}/admin`);
  console.log(`  Ecra da festa ${web}/screen?event=${eventId}`);
  console.log(`  Tabela precos ${web}/prices?event=${eventId}`);
  console.log('');
  console.log('Contas:');
  console.log(`  admin@festa.pt / ${adminPassword}`);
  console.log(`  bar@festa.pt   / ${staffPassword}`);
  console.log(`  caixa@festa.pt / ${cashierPassword}`);
  console.log('');
  console.log('2FA do administrador. Adicione este segredo a uma aplicacao de');
  console.log('autenticacao (Google Authenticator, Aegis, 1Password):');
  console.log(`  Segredo:  ${admin.totpSecret}`);
  console.log(`  otpauth:  ${otpauth}`);
  console.log('='.repeat(70));
  console.log('');

  await app.close();
}

main().catch((error: unknown) => {
  Logger.error(error);
  process.exitCode = 1;
});
