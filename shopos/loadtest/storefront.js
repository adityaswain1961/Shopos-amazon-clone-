// k6 load test modelling real storefront traffic.
//
//   k6 run -e BASE_URL=https://api.staging.example.com loadtest/storefront.js
//   k6 run -e BASE_URL=http://localhost:8000 -e PEAK_RPS=200 loadtest/storefront.js   # laptop smoke
//
// One k6 machine generates roughly 20-50k requests/s. To approach "1M
// concurrent users" (≈ 70-100k req/s, see docs/SCALING.md) run it distributed:
// k6-operator on Kubernetes (free) with N parallel runners, each with
// PEAK_RPS = total / N.
//
// Traffic mix (typical e-commerce): ~80% browse, ~15% cart, ~5% checkout.
// Thresholds encode the SLOs from infrastructure/SLO.md — the run FAILS if
// they are violated, so it can gate a release in CI.

import http from 'k6/http';
import { check, sleep } from 'k6';
import { uuidv4 } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';

const BASE = __ENV.BASE_URL || 'http://localhost:8000';
const PEAK = Number(__ENV.PEAK_RPS || 500);
const DURATION = __ENV.HOLD || '10m';
const SEARCH_TERMS = ['phone', 'shoes', 'laptop', 'watch', 'headphones', 'shirt', 'bag', 'tv'];

export const options = {
  discardResponseBodies: false,
  scenarios: {
    browse: {
      executor: 'ramping-arrival-rate',
      exec: 'browse',
      startRate: 0,
      timeUnit: '1s',
      preAllocatedVUs: Math.ceil(PEAK * 0.8),
      maxVUs: PEAK * 4,
      stages: [
        { target: Math.ceil(PEAK * 0.8), duration: '3m' }, // ramp (watch HPA react)
        { target: Math.ceil(PEAK * 0.8), duration: DURATION },
        { target: 0, duration: '1m' },
      ],
    },
    cart: {
      executor: 'ramping-arrival-rate',
      exec: 'cart',
      startRate: 0,
      timeUnit: '1s',
      preAllocatedVUs: Math.ceil(PEAK * 0.15),
      maxVUs: PEAK,
      stages: [
        { target: Math.ceil(PEAK * 0.15), duration: '3m' },
        { target: Math.ceil(PEAK * 0.15), duration: DURATION },
        { target: 0, duration: '1m' },
      ],
    },
    checkout: {
      executor: 'ramping-arrival-rate',
      exec: 'checkout',
      startRate: 0,
      timeUnit: '1s',
      preAllocatedVUs: Math.max(1, Math.ceil(PEAK * 0.05)),
      maxVUs: Math.max(5, PEAK / 2),
      stages: [
        { target: Math.max(1, Math.ceil(PEAK * 0.05)), duration: '3m' },
        { target: Math.max(1, Math.ceil(PEAK * 0.05)), duration: DURATION },
        { target: 0, duration: '1m' },
      ],
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],                                  // <1% errors overall
    'http_req_duration{flow:browse}': ['p(95)<200', 'p(99)<500'],
    'http_req_duration{flow:cart}': ['p(95)<150', 'p(99)<300'],
    'http_req_duration{flow:checkout}': ['p(99)<1000'],
  },
};

const json = { headers: { 'Content-Type': 'application/json' } };

// Pull a page of real products once, so the test hits real slugs/ids.
export function setup() {
  const res = http.get(`${BASE}/api/v1/products?limit=60`);
  const products = (res.json('data') || []).map((p) => ({ id: p.id, slug: p.slug, variant: p.variants?.[0]?.id }));
  let token = null;
  if (__ENV.TEST_EMAIL && __ENV.TEST_PASSWORD) {
    const login = http.post(
      `${BASE}/api/v1/auth/login`,
      JSON.stringify({ email: __ENV.TEST_EMAIL, password: __ENV.TEST_PASSWORD }),
      json,
    );
    token = login.json('data.tokens.accessToken');
  }
  return { products, token };
}

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

export function browse(data) {
  const tags = { flow: 'browse' };
  const r = Math.random();
  if (r < 0.4 || data.products.length === 0) {
    const res = http.get(`${BASE}/api/v1/products?limit=24`, { tags });
    check(res, { 'list 200': (x) => x.status === 200 });
  } else if (r < 0.8) {
    const p = pick(data.products);
    const res = http.get(`${BASE}/api/v1/products/${p.slug}`, { tags });
    check(res, { 'detail 200': (x) => x.status === 200 });
    http.get(`${BASE}/api/v1/reviews/product/${p.id}/summary`, { tags });
  } else {
    const res = http.get(`${BASE}/api/v1/search?q=${pick(SEARCH_TERMS)}`, { tags });
    check(res, { 'search ok': (x) => x.status === 200 || x.status === 503 });
  }
  sleep(Math.random() * 2);
}

export function cart(data) {
  if (data.products.length === 0) return;
  const tags = { flow: 'cart' };
  const cartId = uuidv4();
  const p = pick(data.products);
  const add = http.post(
    `${BASE}/api/v1/cart/${cartId}/items`,
    JSON.stringify({ product_id: p.id, variant_id: p.variant || 'default', quantity: 1 }),
    { ...json, tags },
  );
  check(add, { 'cart add 200': (x) => x.status === 200 });
  const get = http.get(`${BASE}/api/v1/cart/${cartId}`, { tags });
  check(get, { 'cart get 200': (x) => x.status === 200 });
}

export function checkout(data) {
  if (!data.token || data.products.length === 0) return; // needs TEST_EMAIL/TEST_PASSWORD
  const tags = { flow: 'checkout' };
  const p = pick(data.products);
  const res = http.post(
    `${BASE}/api/v1/orders`,
    JSON.stringify({
      items: [{ productId: p.id, variantId: p.variant, quantity: 1 }],
      shippingAddress: {
        fullName: 'Load Test', line1: '1 Test St', city: 'Bengaluru', postalCode: '560001', phone: '9999999999', country: 'IN',
      },
    }),
    {
      headers: { ...json.headers, Authorization: `Bearer ${data.token}`, 'Idempotency-Key': uuidv4() },
      tags,
    },
  );
  check(res, { 'order accepted': (x) => x.status === 201 || x.status === 200 });
}
