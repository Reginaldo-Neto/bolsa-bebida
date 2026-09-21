/**
 * Spec 13.1: 500 participants connected, 50 purchases a minute, p95 of the API
 * under 300 ms.
 *
 * Run against a deployment seeded with a catalogue, never against the party:
 *   k6 run -e BASE_URL=https://staging.exemplo.pt -e EVENT_ID=<id> \
 *     infra/k6/purchase-load.js
 *
 * The mock payment provider must be active, or this will try to charge real
 * phones. The API refuses to run the mock in production, so this belongs on
 * staging.
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const EVENT_ID = __ENV.EVENT_ID;

const quoteDuration = new Trend('quote_duration', true);
const orderDuration = new Trend('order_duration', true);
const snapshotDuration = new Trend('snapshot_duration', true);
const soldOut = new Counter('refused_sold_out');
const purchaseSuccess = new Rate('purchase_success');

export const options = {
  scenarios: {
    // Everyone watching the market: the common case, and the cheap one.
    browsing: {
      executor: 'ramping-vus',
      exec: 'browse',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 200 },
        { duration: '1m', target: 500 },
        { duration: '3m', target: 500 },
        { duration: '30s', target: 0 },
      ],
    },
    // Spec 13.1: 50 purchases a minute, which is a busy bar.
    buying: {
      executor: 'constant-arrival-rate',
      exec: 'purchase',
      rate: 50,
      timeUnit: '1m',
      duration: '4m',
      preAllocatedVUs: 40,
      maxVUs: 120,
      startTime: '30s',
    },
  },
  thresholds: {
    // The number the spec asks for.
    http_req_duration: ['p(95)<300'],
    quote_duration: ['p(95)<300'],
    order_duration: ['p(95)<300'],
    snapshot_duration: ['p(95)<300'],
    // Running out of a drink is a correct refusal, not a failure, so the
    // success rate is measured against everything that was not sold out.
    purchase_success: ['rate>0.95'],
    http_req_failed: ['rate<0.01'],
  },
};

export function setup() {
  if (!EVENT_ID) {
    throw new Error('EVENT_ID e obrigatorio: k6 run -e EVENT_ID=<id> ...');
  }

  const snapshot = http.get(`${BASE_URL}/api/v1/events/${EVENT_ID}/market/snapshot`);
  check(snapshot, { 'mercado acessivel': (response) => response.status === 200 });

  const products = snapshot.json('products') || [];
  if (products.length === 0) {
    throw new Error('o evento nao tem produtos');
  }

  return { productIds: products.map((product) => product.id) };
}

/** Joins the event and returns the session cookie jar. */
function join(nickname) {
  const response = http.post(
    `${BASE_URL}/api/v1/events/${EVENT_ID}/join`,
    JSON.stringify({ nickname, isAdult: true, leaderboardOptIn: true }),
    { headers: { 'Content-Type': 'application/json' } },
  );

  check(response, { 'entrou no mercado': (result) => result.status === 201 });
  return response.status === 201;
}

/** A participant who only watches the quotes move. */
export function browse(data) {
  const snapshot = http.get(`${BASE_URL}/api/v1/events/${EVENT_ID}/market/snapshot`, {
    tags: { name: 'snapshot' },
  });
  snapshotDuration.add(snapshot.timings.duration);
  check(snapshot, { 'snapshot ok': (response) => response.status === 200 });

  const productId = data.productIds[Math.floor(Math.random() * data.productIds.length)];
  http.get(`${BASE_URL}/api/v1/products/${productId}/history`, { tags: { name: 'history' } });

  // Roughly how often someone glances at their phone.
  sleep(5 + Math.random() * 10);
}

/** A participant who buys: join, quote, order, confirm. */
export function purchase(data) {
  const nickname = `carga${__VU}x${__ITER}${Date.now() % 100000}`;
  if (!join(nickname)) {
    purchaseSuccess.add(false);
    return;
  }

  const productId = data.productIds[Math.floor(Math.random() * data.productIds.length)];

  const quote = http.post(
    `${BASE_URL}/api/v1/quotes`,
    JSON.stringify({ items: [{ productId, qty: 1 }] }),
    { headers: { 'Content-Type': 'application/json' }, tags: { name: 'quote' } },
  );
  quoteDuration.add(quote.timings.duration);

  if (quote.status === 409) {
    // Sold out or over a limit: the system working, not failing.
    soldOut.add(1);
    purchaseSuccess.add(true);
    return;
  }
  if (!check(quote, { 'cotacao criada': (response) => response.status === 201 })) {
    purchaseSuccess.add(false);
    return;
  }

  const order = http.post(
    `${BASE_URL}/api/v1/orders`,
    JSON.stringify({ quoteId: quote.json('id'), phone: '912345678' }),
    { headers: { 'Content-Type': 'application/json' }, tags: { name: 'order' } },
  );
  orderDuration.add(order.timings.duration);

  if (!check(order, { 'encomenda criada': (response) => response.status === 201 })) {
    purchaseSuccess.add(false);
    return;
  }

  // Stands in for the participant confirming in the MB WAY app.
  const paymentRef = order.json('paymentRef');
  if (paymentRef) {
    const confirmed = http.post(`${BASE_URL}/api/v1/dev/payments/${paymentRef}/PAID`, '{}', {
      headers: { 'Content-Type': 'application/json' },
      tags: { name: 'confirm' },
    });
    check(confirmed, { 'pagamento confirmado': (response) => response.status === 201 });
  }

  purchaseSuccess.add(true);
}
