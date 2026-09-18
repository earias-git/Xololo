// XOLOLO: helper para hablar con Skydropx PRO desde el server.
//
// Flujo:
//   1) OAuth client_credentials → bearer token (expira en 2h, 2 req/s).
//      Cacheamos el token en memoria y lo renovamos con 5 min de anticipación.
//   2) POST /quotations con address_from + address_to + parcel → cotización
//      asíncrona. Devuelve un id.
//   3) Polling GET /quotations/{id} hasta is_completed:true (~2-3s en sandbox)
//      → array de rates con success:true/false por paquetería.
//
// Uso típico:
//   const { getQuotationRates } = require('./api-util/skydropx');
//   const rates = await getQuotationRates({
//     from: { postal_code, area_level1, area_level2, area_level3 },
//     to:   { ... },
//     parcel: { length, width, height, weight },
//   });
//
// Errores:
//   - SkydropxAuthError: credenciales inválidas o expiradas.
//   - SkydropxQuoteError: cotización rechazada (schema, geografía, etc).
//   - SkydropxTimeoutError: polling excedió MAX_POLL_MS.

const HOST = process.env.SKYDROPX_HOST || 'sb-pro.skydropx.com';
const CLIENT_ID = process.env.SKYDROPX_CLIENT_ID;
const CLIENT_SECRET = process.env.SKYDROPX_CLIENT_SECRET;

const TOKEN_URL = `https://${HOST}/api/v1/oauth/token`;
const QUOTATION_URL = `https://${HOST}/api/v1/quotations`;

// Refresh 5 min antes de la expiración real para evitar carreras.
const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000;
// Polling: hasta 25s, chequeando cada 1s. Sandbox suele tardar 5-10s en
// completar todos los carriers; producción es más rápido (~2-3s). Con 25s
// cubrimos ambos casos con margen. Si queremos respuesta más rápida al
// buyer, podemos devolver rates parciales (los que ya completaron) al
// llegar al timeout — en v2.
const MAX_POLL_MS = 25000;
const POLL_INTERVAL_MS = 1000;

class SkydropxAuthError extends Error {
  constructor(msg) {
    super(msg);
    this.name = 'SkydropxAuthError';
  }
}
class SkydropxQuoteError extends Error {
  constructor(msg, details) {
    super(msg);
    this.name = 'SkydropxQuoteError';
    this.details = details;
  }
}
class SkydropxTimeoutError extends Error {
  constructor(msg) {
    super(msg);
    this.name = 'SkydropxTimeoutError';
  }
}

// Cache in-process del bearer token. Sirve para todos los requests del proceso
// hasta que expire. En producción con múltiples instancias cada una tiene su
// propio cache — es aceptable porque el rate limit es por credencial (2 req/s)
// y el token endpoint no cuenta contra ese límite.
let tokenCache = null; // { token: string, expiresAt: number }

const getAccessToken = async () => {
  const now = Date.now();
  if (tokenCache && tokenCache.expiresAt - TOKEN_REFRESH_MARGIN_MS > now) {
    return tokenCache.token;
  }

  if (!CLIENT_ID || !CLIENT_SECRET) {
    throw new SkydropxAuthError(
      'SKYDROPX_CLIENT_ID o SKYDROPX_CLIENT_SECRET no están configurados.'
    );
  }

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
  });

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.access_token) {
    throw new SkydropxAuthError(
      `Handshake Skydropx falló (${res.status}): ${data?.error || 'sin respuesta'}`
    );
  }

  tokenCache = {
    token: data.access_token,
    // expires_in viene en segundos.
    expiresAt: now + data.expires_in * 1000,
  };
  return tokenCache.token;
};

// Crea una cotización asíncrona y espera a que Skydropx la complete.
// Devuelve solo los rates con success:true, ordenados por precio ascendente.
//
// from/to esperan: { postal_code, area_level1, area_level2, area_level3, country_code? }
// parcel espera:  { length, width, height, weight } — cm y kg respectivamente.
const getQuotationRates = async ({ from, to, parcel }) => {
  const token = await getAccessToken();

  const createRes = await fetch(QUOTATION_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      quotation: {
        address_from: { country_code: 'MX', ...from },
        address_to: { country_code: 'MX', ...to },
        parcel,
      },
    }),
  });
  const created = await createRes.json().catch(() => null);
  if (!createRes.ok || !created?.id) {
    throw new SkydropxQuoteError(
      `Skydropx rechazó la cotización (${createRes.status})`,
      created?.errors || created
    );
  }

  // Poll hasta is_completed:true o timeout.
  const quotationId = created.id;
  const start = Date.now();
  let last = created;
  while (!last.is_completed && Date.now() - start < MAX_POLL_MS) {
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
    const pollRes = await fetch(`${QUOTATION_URL}/${quotationId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    last = await pollRes.json().catch(() => ({}));
    if (!pollRes.ok) {
      throw new SkydropxQuoteError(
        `Polling de cotización falló (${pollRes.status})`,
        last
      );
    }
  }

  if (!last.is_completed) {
    throw new SkydropxTimeoutError(
      `Cotización ${quotationId} no completó en ${MAX_POLL_MS}ms`
    );
  }

  const successRates = (last.rates || [])
    .filter(r => r.success)
    .map(r => ({
      id: r.id,
      carrier: r.provider_display_name,
      carrierCode: r.provider_name,
      service: r.provider_service_name,
      serviceCode: r.provider_service_code,
      total: Number(r.total),
      currency: r.currency_code || 'MXN',
      days: r.days,
      pickup: r.pickup,
      officeDelivery: r.office_delivery,
    }))
    .sort((a, b) => a.total - b.total);

  return { quotationId, rates: successRates };
};

module.exports = {
  getAccessToken,
  getQuotationRates,
  SkydropxAuthError,
  SkydropxQuoteError,
  SkydropxTimeoutError,
};
