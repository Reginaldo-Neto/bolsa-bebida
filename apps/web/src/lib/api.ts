import type {
  JoinRequest,
  MarketSnapshot,
  ProblemCode,
  ProblemDetails,
  QuoteResponse,
} from '@bolsa/shared';

const BASE_URL = import.meta.env.VITE_API_URL ?? '';

/** An error the server described in RFC 9457 terms (spec 10). */
export class ApiError extends Error {
  readonly code: ProblemCode | 'network-error';
  readonly status: number;
  readonly meta: Record<string, unknown> | undefined;

  constructor(
    problem: Pick<ProblemDetails, 'code' | 'status' | 'detail' | 'title'> & {
      meta?: Record<string, unknown>;
    },
  ) {
    super(problem.detail ?? problem.title);
    this.name = 'ApiError';
    this.code = problem.code;
    this.status = problem.status;
    this.meta = problem.meta;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;

  try {
    response = await fetch(`${BASE_URL}/api/v1${path}`, {
      ...init,
      // The participant session is an httpOnly cookie (spec 3).
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...init.headers,
      },
    });
  } catch {
    throw new ApiError({
      code: 'network-error' as ProblemCode,
      status: 0,
      title: 'Sem ligacao',
      detail: 'Nao foi possivel contactar o servidor. Verifique a ligacao.',
    });
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const body: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const problem = body as ProblemDetails | null;
    throw new ApiError({
      code: problem?.code ?? ('internal-error' as ProblemCode),
      status: response.status,
      title: problem?.title ?? 'Erro',
      ...(problem?.detail !== undefined ? { detail: problem.detail } : {}),
      ...(problem?.meta !== undefined ? { meta: problem.meta } : {}),
    });
  }

  return body as T;
}

export interface ParticipantSummary {
  id: string;
  eventId: string;
  nickname: string;
  isAdultDeclared: boolean;
  leaderboardOptIn: boolean;
  teamCode: string | null;
}

export interface OrderSummary {
  id: string;
  status: string;
  totalCents: number;
  createdAt: string;
  expiresAt: string;
  paymentRef: string | null;
  items: {
    id: string;
    productId: string;
    name: string;
    qty: number;
    unitPriceCents: number;
    redeemedQty: number;
  }[];
  voucher: { id: string; shortCode: string; qr: string; status: string } | null;
}

export interface LeaderboardEntry {
  participantId: string;
  nickname: string;
  teamCode: string | null;
  points: number;
  position: number;
}

export interface LeaderboardView {
  entries: LeaderboardEntry[];
  me: (LeaderboardEntry & { optedIn: boolean }) | null;
  teams: { teamCode: string; points: number; members: number; position: number }[];
}

export interface PricePoint {
  tick: number;
  priceCents: number;
  at: string;
}

export const api = {
  join: (eventId: string, body: JoinRequest) =>
    request<ParticipantSummary>(`/events/${eventId}/join`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  me: () => request<ParticipantSummary>('/me'),

  snapshot: (eventId: string) => request<MarketSnapshot>(`/events/${eventId}/market/snapshot`),

  history: (productId: string, from?: string) =>
    request<PricePoint[]>(
      `/products/${productId}/history${from ? `?from=${encodeURIComponent(from)}` : ''}`,
    ),

  createQuote: (items: { productId: string; qty: number }[]) =>
    request<QuoteResponse>('/quotes', {
      method: 'POST',
      body: JSON.stringify({ items }),
    }),

  createOrder: (body: { quoteId: string; phone: string; nif?: string }) =>
    request<OrderSummary>('/orders', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  myOrders: () => request<OrderSummary[]>('/me/orders'),

  leaderboard: () => request<LeaderboardView>('/leaderboard'),

  setLeaderboardOptIn: (optIn: boolean) =>
    request<{ optedIn: boolean }>('/me/leaderboard', {
      method: 'POST',
      body: JSON.stringify({ optIn }),
    }),

  /**
   * Development only: stands in for the participant confirming in the MB WAY
   * app. The API refuses this route outside development.
   */
  simulatePayment: (paymentRef: string, status: 'PAID' | 'FAILED') =>
    request<{ applied: boolean }>(`/dev/payments/${paymentRef}/${status}`, {
      method: 'POST',
      body: '{}',
    }),
};
