import { newId } from '@bolsa/db';
import { DomainError, productInputSchema, type ProductInput, type ReportType } from '@bolsa/shared';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';

/**
 * Spec 4.7: exportable reports, and CSV import/export of the catalogue.
 *
 * Money is written in cents, not euros: a spreadsheet that reads "1,50" in a
 * Portuguese locale and "1.50" in an English one is how a price list silently
 * becomes wrong.
 */
@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async report(eventId: string, type: ReportType): Promise<string> {
    switch (type) {
      case 'vendas':
        return this.sales(eventId);
      case 'precos':
        return this.prices(eventId);
      case 'levantamentos':
        return this.redemptions(eventId);
      case 'reembolsos':
        return this.refunds(eventId);
    }
  }

  private async sales(eventId: string): Promise<string> {
    const items = await this.prisma.client.orderItem.findMany({
      where: { product: { eventId } },
      include: {
        product: { select: { name: true } },
        order: {
          select: {
            id: true,
            status: true,
            createdAt: true,
            nif: true,
            participant: { select: { nickname: true } },
          },
        },
      },
      orderBy: { order: { createdAt: 'asc' } },
    });

    return toCsv(
      [
        'encomenda',
        'estado',
        'criada_em',
        'participante',
        'nif',
        'produto',
        'quantidade',
        'preco_unitario_centimos',
        'preco_base_centimos',
        'total_centimos',
        'levantado',
      ],
      items.map((item) => [
        item.order.id,
        item.order.status,
        item.order.createdAt.toISOString(),
        item.order.participant.nickname,
        item.order.nif ?? '',
        item.product.name,
        item.qty,
        item.unitPriceCents,
        item.basePriceCentsAtPurchase,
        item.unitPriceCents * item.qty,
        item.redeemedQty,
      ]),
    );
  }

  /** Spec 13.3: the full price history with its signals, for later analysis. */
  private async prices(eventId: string): Promise<string> {
    const ticks = await this.prisma.client.priceTick.findMany({
      where: { eventId },
      include: { product: { select: { name: true } } },
      orderBy: [{ tick: 'asc' }, { productId: 'asc' }],
    });

    return toCsv(
      [
        'tick',
        'momento',
        'produto',
        'preco_centimos',
        'unidades_pagas',
        'x',
        'r',
        'k',
        'delta',
        'c',
      ],
      ticks.map((tick) => {
        const explain = (tick.explain ?? {}) as Record<string, number>;
        return [
          tick.tick,
          tick.createdAt.toISOString(),
          tick.product.name,
          tick.priceCents,
          tick.paidUnits,
          explain.x ?? '',
          explain.r ?? '',
          explain.k ?? '',
          explain.delta ?? '',
          explain.c ?? '',
        ];
      }),
    );
  }

  private async redemptions(eventId: string): Promise<string> {
    const redemptions = await this.prisma.client.redemption.findMany({
      where: { voucher: { eventId } },
      include: {
        voucher: { select: { shortCode: true } },
        orderItem: { include: { product: { select: { name: true } } } },
        staffUser: { select: { email: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    return toCsv(
      ['momento', 'voucher', 'produto', 'quantidade', 'staff', 'ponto', 'idade_verificada'],
      redemptions.map((redemption) => [
        redemption.createdAt.toISOString(),
        redemption.voucher.shortCode,
        redemption.orderItem.product.name,
        redemption.qty,
        redemption.staffUser.email,
        redemption.pickupPoint ?? '',
        redemption.ageChecked ? 'sim' : 'nao',
      ]),
    );
  }

  private async refunds(eventId: string): Promise<string> {
    const refunds = await this.prisma.client.refund.findMany({
      where: { order: { participant: { eventId } } },
      include: {
        order: { select: { id: true, totalCents: true } },
        adminUser: { select: { email: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    return toCsv(
      ['momento', 'encomenda', 'total_encomenda_centimos', 'reembolso_centimos', 'motivo', 'admin'],
      refunds.map((refund) => [
        refund.createdAt.toISOString(),
        refund.order.id,
        refund.order.totalCents,
        refund.amountCents,
        refund.reason,
        refund.adminUser.email,
      ]),
    );
  }

  /** Spec 4.2: the catalogue leaves as CSV and comes back the same way. */
  async exportProducts(eventId: string): Promise<string> {
    const products = await this.prisma.client.product.findMany({
      where: { eventId, archived: false },
      include: { group: { select: { name: true } } },
      orderBy: { sortOrder: 'asc' },
    });

    return toCsv(
      [
        'nome',
        'grupo',
        'categoria',
        'alcoolica',
        'volume_ml',
        'custo_centimos',
        'preco_base_centimos',
        'preco_minimo_centimos',
        'preco_maximo_centimos',
        'stock_inicial',
        'ordem',
      ],
      products.map((product) => [
        product.name,
        product.group.name,
        product.category ?? '',
        product.isAlcoholic ? 'sim' : 'nao',
        product.volumeMl ?? '',
        product.costCents,
        product.basePriceCents,
        product.minPriceCents,
        product.maxPriceCents,
        product.stockInitial,
        product.sortOrder,
      ]),
    );
  }

  /**
   * Parses a catalogue CSV into validated products. Nothing is written here:
   * the caller decides what to do with rows that failed, so a single bad line
   * does not half-import a price list.
   */
  parseProductsCsv(csv: string): { products: ProductInput[]; errors: string[] } {
    const rows = parseCsv(csv);
    const header = rows.shift();

    if (!header) {
      throw new DomainError('validation-failed', 'O ficheiro CSV esta vazio.');
    }

    const index = (name: string): number => header.indexOf(name);
    const required = [
      'nome',
      'grupo',
      'preco_base_centimos',
      'preco_minimo_centimos',
      'preco_maximo_centimos',
    ];
    const missing = required.filter((column) => index(column) === -1);
    if (missing.length > 0) {
      throw new DomainError('validation-failed', `Faltam colunas no CSV: ${missing.join(', ')}`);
    }

    const products: ProductInput[] = [];
    const errors: string[] = [];

    rows.forEach((row, position) => {
      if (row.every((cell) => cell.trim() === '')) {
        return;
      }

      const value = (name: string): string => row[index(name)]?.trim() ?? '';
      const number = (name: string): number | undefined => {
        const raw = value(name);
        return raw === '' ? undefined : Number(raw);
      };

      const candidate = {
        name: value('nome'),
        groupName: value('grupo'),
        category: value('categoria') || undefined,
        isAlcoholic: value('alcoolica').toLowerCase() !== 'nao',
        volumeMl: number('volume_ml'),
        costCents: number('custo_centimos') ?? 0,
        basePriceCents: number('preco_base_centimos'),
        minPriceCents: number('preco_minimo_centimos'),
        maxPriceCents: number('preco_maximo_centimos'),
        stockInitial: number('stock_inicial') ?? 0,
        sortOrder: number('ordem'),
      };

      const parsed = productInputSchema.safeParse(candidate);
      if (!parsed.success) {
        errors.push(`Linha ${position + 2}: ${parsed.error.issues[0]?.message ?? 'invalida'}`);
        return;
      }
      if (
        parsed.data.minPriceCents > parsed.data.basePriceCents ||
        parsed.data.basePriceCents > parsed.data.maxPriceCents
      ) {
        errors.push(`Linha ${position + 2}: o preco base tem de estar entre o minimo e o maximo`);
        return;
      }

      products.push(parsed.data);
    });

    return { products, errors };
  }

  /** Replaces the catalogue in one transaction, so a failure leaves it intact. */
  async importProducts(eventId: string, products: ProductInput[]): Promise<number> {
    return this.prisma.client.$transaction(async (tx) => {
      for (const product of products) {
        const group = await tx.productGroup.upsert({
          where: { eventId_name: { eventId, name: product.groupName } },
          update: {},
          create: { id: newId(), eventId, name: product.groupName },
        });

        const existing = await tx.product.findUnique({
          where: { eventId_name: { eventId, name: product.name } },
        });

        const data = {
          groupId: group.id,
          category: product.category ?? null,
          isAlcoholic: product.isAlcoholic,
          volumeMl: product.volumeMl ?? null,
          costCents: product.costCents,
          basePriceCents: product.basePriceCents,
          minPriceCents: product.minPriceCents,
          maxPriceCents: product.maxPriceCents,
          sortOrder: product.sortOrder ?? 0,
          archived: false,
        };

        if (existing) {
          await tx.product.update({ where: { id: existing.id }, data });
        } else {
          await tx.product.create({
            data: {
              ...data,
              id: newId(),
              eventId,
              name: product.name,
              stockInitial: product.stockInitial,
              stockAvailable: product.stockInitial,
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

      return products.length;
    });
  }
}

/**
 * Excel on a Portuguese machine reads a UTF-8 file as Latin-1 unless it starts
 * with a byte order mark. Built from its code point rather than typed as a
 * literal, which would be an invisible character sitting in the source.
 */
const BOM = String.fromCharCode(0xfeff);

function escapeCell(value: string | number): string {
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(header: string[], rows: (string | number)[][]): string {
  return `${BOM}${[header, ...rows].map((row) => row.map(escapeCell).join(',')).join('\r\n')}\r\n`;
}

/** A minimal RFC 4180 reader: quoted fields, escaped quotes, CRLF or LF. */
export function parseCsv(input: string): string[][] {
  const text = input.startsWith(BOM) ? input.slice(BOM.length) : input;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(cell);
      cell = '';
    } else if (char === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else if (char !== '\r') {
      cell += char;
    }
  }

  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  return rows;
}
