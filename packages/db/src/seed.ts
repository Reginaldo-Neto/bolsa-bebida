import { DEFAULT_ENGINE_PARAMS, DEFAULT_EVENT_LIMITS } from '@bolsa/shared';
import { createPrismaClient } from './client';
import { newId } from './ids';

/**
 * Development seed: one event with a plausible Portuguese bar catalogue.
 * Substitution groups matter more than the exact drinks: the engine only has
 * something to do when a group holds at least two competing products.
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
      // L8: water is always available and always listed in the market.
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
  const prisma = createPrismaClient();

  try {
    const eventId = newId();
    await prisma.event.create({
      data: {
        id: eventId,
        name: 'Festa de teste',
        status: 'DRAFT',
        engineParams: { ...DEFAULT_ENGINE_PARAMS },
        limits: { ...DEFAULT_EVENT_LIMITS },
      },
    });

    let sortOrder = 0;
    for (const entry of CATALOG) {
      const groupId = newId();
      await prisma.productGroup.create({
        data: { id: groupId, eventId, name: entry.group },
      });

      for (const product of entry.products) {
        sortOrder += 1;
        const productId = newId();
        await prisma.product.create({
          data: {
            id: productId,
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

    console.log(`Evento criado: ${eventId}`);
    console.log(`${sortOrder} produtos em ${CATALOG.length} grupos de substituicao.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
