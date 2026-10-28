// XOLOLO 2026-10-27: health check de dependencias externas.
//
// GET /admin/system-health
// Auth: requireOperator con MFA opcional.
//
// Response:
//   200 → { status: 'ok' | 'degraded' | 'down', checks: [...] }
//     Siempre 200 — el status general viene en el body. Un operador
//     puede ver qué dependencia específica falla.
//
// Cada check devuelve:
//   { name, status: 'ok'|'warn'|'fail', latencyMs, details?, error? }
//
// Timeout por check: 5s. Para no bloquear la respuesta general, todas
// corren en paralelo con Promise.allSettled.

const { getIntegrationSdk } = require('../api-util/integrationSdk');
const { listOperators, invalidateCache } = require('../api-util/operatorDirectory');

const TIMEOUT_MS = 5000;

const withTimeout = (promise, ms = TIMEOUT_MS) =>
  Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ]);

const measure = async (name, fn) => {
  const start = Date.now();
  try {
    const details = await withTimeout(fn());
    return {
      name,
      status: 'ok',
      latencyMs: Date.now() - start,
      details,
    };
  } catch (e) {
    return {
      name,
      status: 'fail',
      latencyMs: Date.now() - start,
      error: e?.message || String(e),
    };
  }
};

// === Checks individuales ===

const checkSharetribeIntegration = () =>
  measure('sharetribe_integration', async () => {
    const sdk = getIntegrationSdk();
    if (!sdk) throw new Error('integration_sdk_not_configured');
    const resp = await sdk.users.query({ perPage: 1 });
    return { users_sample_count: resp.data.data.length };
  });

const checkR2 = () =>
  measure('r2_operators_directory', async () => {
    // Invalidar cache para que el health check golpee R2 real.
    invalidateCache();
    const ops = await listOperators();
    if (!Array.isArray(ops)) throw new Error('operators_not_array');
    const active = ops.filter(o => !o.suspendedAt).length;
    return {
      operators_total: ops.length,
      operators_active: active,
    };
  });

const checkStripe = () =>
  measure('stripe', async () => {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error('stripe_secret_key_missing');
    const res = await fetch('https://api.stripe.com/v1/balance', {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (!res.ok) {
      throw new Error(`stripe_${res.status}`);
    }
    const data = await res.json();
    return { available_count: (data.available || []).length };
  });

const checkSkydropx = () =>
  measure('skydropx', async () => {
    const clientId = process.env.SKYDROPX_CLIENT_ID;
    const clientSecret = process.env.SKYDROPX_CLIENT_SECRET;
    const host = process.env.SKYDROPX_HOST || 'sb-pro.skydropx.com';
    if (!clientId || !clientSecret) throw new Error('skydropx_credentials_missing');
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
    });
    const res = await fetch(`https://${host}/api/v1/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    if (!res.ok) throw new Error(`skydropx_oauth_${res.status}`);
    const data = await res.json();
    return {
      token_type: data.token_type,
      expires_in_s: data.expires_in,
      env: host.includes('sb-') ? 'sandbox' : 'production',
    };
  });

const checkAnthropic = () =>
  measure('anthropic', async () => {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) throw new Error('anthropic_api_key_missing');
    // Ping muy barato: list models (no gasta tokens).
    const res = await fetch('https://api.anthropic.com/v1/models', {
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
    });
    if (!res.ok) throw new Error(`anthropic_${res.status}`);
    const data = await res.json();
    return { models_available: Array.isArray(data.data) ? data.data.length : 0 };
  });

const checkAlgolia = () =>
  measure('algolia', async () => {
    const appId = process.env.ALGOLIA_APP_ID;
    const key = process.env.ALGOLIA_ADMIN_API_KEY;
    const index = process.env.ALGOLIA_INDEX_NAME;
    if (!appId || !key || !index) throw new Error('algolia_env_missing');
    const res = await fetch(
      `https://${appId}-dsn.algolia.net/1/indexes/${encodeURIComponent(index)}/query`,
      {
        method: 'POST',
        headers: {
          'X-Algolia-API-Key': key,
          'X-Algolia-Application-Id': appId,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ params: 'query=&hitsPerPage=0' }),
      }
    );
    if (!res.ok) throw new Error(`algolia_${res.status}`);
    const data = await res.json();
    return { nbHits: data.nbHits };
  });

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });

  const results = await Promise.allSettled([
    checkSharetribeIntegration(),
    checkR2(),
    checkStripe(),
    checkSkydropx(),
    checkAnthropic(),
    checkAlgolia(),
  ]);

  const checks = results.map(r =>
    r.status === 'fulfilled'
      ? r.value
      : { name: 'unknown', status: 'fail', error: r.reason?.message }
  );

  const anyFail = checks.some(c => c.status === 'fail');
  const anyWarn = checks.some(c => c.status === 'warn');
  const overall = anyFail ? 'down' : anyWarn ? 'degraded' : 'ok';

  return res.json({
    status: overall,
    checkedAt: new Date().toISOString(),
    checks,
  });
};
