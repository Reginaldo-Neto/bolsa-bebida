import type { EventAction, LoginRequest, ProductInput } from '@bolsa/shared';
import { ApiError } from './api';

const BASE_URL = import.meta.env.VITE_API_URL ?? '';

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${BASE_URL}/api/v1${path}`, {
    ...init,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...init.headers },
  });

  const isCsv = response.headers.get('content-type')?.includes('text/csv');
  const body: unknown = isCsv ? await response.text() : await response.json().catch(() => null);

  if (!response.ok) {
    const problem = body as { code?: string; title?: string; detail?: string } | null;
    throw new ApiError({
      code: (problem?.code ?? 'internal-error') as never,
      status: response.status,
      title: problem?.title ?? 'Erro',
      ...(problem?.detail !== undefined ? { detail: problem.detail } : {}),
    });
  }

  return body as T;
}

export interface StaffSummary {
  id: string;
  eventId: string;
  email: string;
  role: 'STAFF' | 'ADMIN';
  pickupPoint: string | null;
}

export interface ScannedItem {
  orderItemId: string;
  productId: string;
  name: string;
  isAlcoholic: boolean;
  qty: number;
  redeemedQty: number;
  pendingQty: number;
}

export interface ScannedVoucher {
  voucherId: string;
  shortCode: string;
  status: string;
  nickname: string;
  requiresAgeCheck: boolean;
  items: ScannedItem[];
  lastRedemption: { at: string; pickupPoint: string | null } | null;
}

export interface AdminDashboard {
  revenueCents: number;
  unitsSold: number;
  pendingOrders: number;
  lowStockProducts: number;
  lastTickAt: string | null;
  products: {
    id: string;
    name: string;
    priceCents: number;
    basePriceCents: number;
    stockAvailable: number;
    stockReserved: number;
    stockSold: number;
    unitsSold: number;
  }[];
}

export interface AuditEntry {
  id: string;
  actorType: string;
  action: string;
  entity: string;
  entityId: string | null;
  createdAt: string;
  after: unknown;
}

export const staffApi = {
  login: (body: LoginRequest) =>
    request<StaffSummary>('/auth/login', { method: 'POST', body: JSON.stringify(body) }),

  logout: () => request<{ ok: true }>('/auth/logout', { method: 'POST' }),

  me: () => request<StaffSummary>('/auth/me'),

  scan: (body: { qr: string } | { shortCode: string }) =>
    request<ScannedVoucher>('/staff/vouchers/scan', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  redeem: (
    voucherId: string,
    body: { items: { orderItemId: string; qty: number }[]; ageChecked: boolean },
  ) =>
    request<ScannedVoucher>(`/staff/vouchers/${voucherId}/redeem`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
};

export const adminApi = {
  dashboard: () => request<AdminDashboard>('/admin/dashboard'),

  changeState: (action: EventAction['action']) =>
    request<{ status: string; fixedPrices: boolean }>('/admin/events/state', {
      method: 'POST',
      body: JSON.stringify({ action }),
    }),

  updateEngineParams: (patch: Record<string, number | boolean>) =>
    request<Record<string, number | boolean>>('/admin/events/engine-params', {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),

  override: (productId: string, body: { priceCents: number; ticks: number }) =>
    request<{ productId: string; priceCents: number; untilTick: number }>(
      `/admin/products/${productId}/override`,
      { method: 'POST', body: JSON.stringify(body) },
    ),

  adjustStock: (productId: string, body: { delta: number; reason: string }) =>
    request<{ id: string; stockAvailable: number }>(`/admin/products/${productId}/stock-adjust`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  createProduct: (body: ProductInput) =>
    request<{ id: string }>('/admin/products', { method: 'POST', body: JSON.stringify(body) }),

  refund: (orderId: string, body: { reason: string; restock: boolean }) =>
    request<{ orderId: string; amountCents: number }>(`/admin/orders/${orderId}/refund`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  audit: () => request<AuditEntry[]>('/admin/audit'),

  exportProductsCsv: () => request<string>('/admin/products.csv'),

  importProductsCsv: (csv: string) =>
    request<{ imported: number; errors: string[] }>('/admin/products.csv', {
      method: 'POST',
      body: JSON.stringify({ csv }),
    }),

  reportUrl: (type: string) => `${BASE_URL}/api/v1/admin/reports/${type}.csv`,
};
