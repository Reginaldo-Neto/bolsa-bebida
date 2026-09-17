/**
 * RFC 9457 Problem Details (spec 10). Every API error is one of these codes,
 * so the PWA can react without parsing prose.
 */
export const PROBLEM_BASE_URI = 'https://bolsa-bebidas.pt/problems';

export const PROBLEM_CODES = [
  'validation-failed',
  'unauthorized',
  'forbidden',
  'not-found',
  'event-not-open',
  'sales-closed',
  'quote-expired',
  'quote-already-used',
  'insufficient-stock',
  'product-sold-out',
  'quantity-limit-exceeded',
  'alcohol-limit-exceeded',
  'adult-declaration-required',
  'payment-failed',
  'payment-timeout',
  'voucher-invalid',
  'voucher-already-redeemed',
  'voucher-wrong-event',
  'redemption-conflict',
  'price-out-of-range',
  'rate-limited',
  'idempotency-conflict',
  'internal-error',
] as const;

export type ProblemCode = (typeof PROBLEM_CODES)[number];

export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  code: ProblemCode;
  detail?: string;
  instance?: string;
  /** Machine-readable context, e.g. { productId, available }. */
  meta?: Record<string, unknown>;
}

const PROBLEM_DEFAULTS: Record<ProblemCode, { status: number; title: string }> = {
  'validation-failed': { status: 400, title: 'Dados invalidos' },
  unauthorized: { status: 401, title: 'Sessao invalida' },
  forbidden: { status: 403, title: 'Sem permissao' },
  'not-found': { status: 404, title: 'Nao encontrado' },
  'event-not-open': { status: 409, title: 'O mercado nao esta aberto' },
  'sales-closed': { status: 409, title: 'As vendas estao fechadas' },
  'quote-expired': { status: 409, title: 'A cotacao expirou' },
  'quote-already-used': { status: 409, title: 'A cotacao ja foi usada' },
  'insufficient-stock': { status: 409, title: 'Stock insuficiente' },
  'product-sold-out': { status: 409, title: 'Produto esgotado' },
  'quantity-limit-exceeded': { status: 409, title: 'Limite por encomenda excedido' },
  'alcohol-limit-exceeded': { status: 409, title: 'Limite de consumo atingido' },
  'adult-declaration-required': { status: 403, title: 'Declaracao 18+ necessaria' },
  'payment-failed': { status: 402, title: 'Pagamento recusado' },
  'payment-timeout': { status: 408, title: 'Pagamento expirou' },
  'voucher-invalid': { status: 400, title: 'Voucher invalido' },
  'voucher-already-redeemed': { status: 409, title: 'Voucher ja levantado' },
  'voucher-wrong-event': { status: 400, title: 'Voucher invalido' },
  'redemption-conflict': { status: 409, title: 'Levantamento em conflito' },
  'price-out-of-range': { status: 400, title: 'Preco fora do intervalo' },
  'rate-limited': { status: 429, title: 'Demasiados pedidos' },
  'idempotency-conflict': { status: 409, title: 'Pedido duplicado com dados diferentes' },
  'internal-error': { status: 500, title: 'Erro interno' },
};

export function problem(
  code: ProblemCode,
  options: { detail?: string; instance?: string; meta?: Record<string, unknown> } = {},
): ProblemDetails {
  const defaults = PROBLEM_DEFAULTS[code];
  return {
    type: `${PROBLEM_BASE_URI}/${code}`,
    title: defaults.title,
    status: defaults.status,
    code,
    ...(options.detail !== undefined ? { detail: options.detail } : {}),
    ...(options.instance !== undefined ? { instance: options.instance } : {}),
    ...(options.meta !== undefined ? { meta: options.meta } : {}),
  };
}

export function problemStatus(code: ProblemCode): number {
  return PROBLEM_DEFAULTS[code].status;
}

/** Thrown by domain code; the HTTP layer turns it into a Problem Details body. */
export class DomainError extends Error {
  readonly code: ProblemCode;
  readonly meta: Record<string, unknown> | undefined;

  constructor(code: ProblemCode, detail?: string, meta?: Record<string, unknown>) {
    super(detail ?? PROBLEM_DEFAULTS[code].title);
    this.name = 'DomainError';
    this.code = code;
    this.meta = meta;
  }

  toProblem(instance?: string): ProblemDetails {
    return problem(this.code, {
      ...(this.message ? { detail: this.message } : {}),
      ...(instance !== undefined ? { instance } : {}),
      ...(this.meta !== undefined ? { meta: this.meta } : {}),
    });
  }
}
