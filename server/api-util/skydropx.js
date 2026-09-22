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
// Polling: hasta 40s, chequeando cada 1s. Sandbox de Skydropx pega
// tirones — hemos visto cotizaciones que tardan 20-30s en completar
// todos los carriers (esp. cuando DHL/Estafeta responden lento).
// Producción es más rápido (~2-3s). Con 40s cubrimos el peor caso del
// sandbox sin bloquear al buyer indefinidamente. Si queremos respuesta
// más rápida podemos devolver rates parciales (los que ya completaron)
// al llegar al timeout — en v2.
const MAX_POLL_MS = 40000;
const POLL_INTERVAL_MS = 1000;

// XOLOLO: política de pricing (ver docs/LOGISTICS_V1.md §5).
// - SOS Protección Skydropx: $25 MXN fijo por envío, obligatorio siempre.
// - Utilidad Xololo: 14% sobre el bruto Skydropx (guía + SOS).
// Fórmula: precio_público = (rate_skydropx + 25) × 1.14
// Constantes exportadas para poder usarlas también al crear la guía y
// facturar/desglosar en el ledger interno.
const SOS_INSURANCE_MXN = 25;
const XOLOLO_MARGIN_PCT = 0.14;

const applyPricingPolicy = skydropxTotalMXN => {
  const bruto = Number(skydropxTotalMXN) + SOS_INSURANCE_MXN;
  const totalPublico = bruto * (1 + XOLOLO_MARGIN_PCT);
  return {
    skydropxTotal: Number(skydropxTotalMXN),
    sosInsurance: SOS_INSURANCE_MXN,
    skydropxBruto: Number(bruto.toFixed(2)),
    xololoMargin: Number((bruto * XOLOLO_MARGIN_PCT).toFixed(2)),
    totalPublico: Number(totalPublico.toFixed(2)),
  };
};

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
    .map(r => {
      // XOLOLO: aplicamos la política de pricing (SOS obligatorio + margen).
      // El cliente y checkout ven `total` = precio público final.
      // `pricing` desglosa por si se necesita auditar o mostrar en el UI.
      const pricing = applyPricingPolicy(Number(r.total));
      return {
        id: r.id,
        carrier: r.provider_display_name,
        carrierCode: r.provider_name,
        service: r.provider_service_name,
        serviceCode: r.provider_service_code,
        total: pricing.totalPublico,
        currency: r.currency_code || 'MXN',
        days: r.days,
        pickup: r.pickup,
        officeDelivery: r.office_delivery,
        pricing,
      };
    })
    .sort((a, b) => a.total - b.total);

  return { quotationId, rates: successRates };
};

// XOLOLO: defaults SAT Carta Porte + tipo de empaque cuando el listing
// no los define. Skydropx exige ambos por paquete y sólo acepta códigos
// de su catálogo (48,962 códigos SAT en 2449 páginas — no es libre).
// Para v1 usamos códigos genéricos aceptados:
//   4G       = Caja de cartón (el más común)
//   60122500 = Manualidades de papel y papel artesanal (fallback para
//              productos generales; funciona para mayoría de artesanías,
//              regalos, souvenirs, hogar).
// TODO v2: mapeo curado categoría-listing → código SAT, en
// docs/consignment-note-catalog.md. El seller no debería tener que
// elegirlo manual.
const DEFAULT_PACKAGE_TYPE = '4G';
const DEFAULT_CONSIGNMENT_NOTE = '60122500';

// XOLOLO: crear un envío (generar guía Skydropx). Se llama desde
// D.5 (UI seller "Generar guía") cuando:
//   1. El buyer ya eligió rate en checkout (viven en
//      transaction.protectedData.xololoShipping.rate.id y quotationId)
//   2. El seller cargó las 5 fotos SOS (bloqueado por el botón)
//   3. El seller confirmó detalles del paquete
//
// Endpoint: POST /api/v1/shipments
// Body wrapper "shipment" en el root; rate_id es todo lo que se necesita
// del rate (quotation_id se deriva del rate). Campos requeridos:
// address_from + address_to con street1, name, company, phone, email, reference;
// packages[] con package_type, consignment_note y package_protected.
// Descubierto navegando la docs "Crea un envío" en sb-pro.skydropx.com.
//
// Entrada helper:
//   {
//     rateId, quotationId (opcional; sirve como referencia interna),
//     addressFrom: {street1, name, company, phone, email, reference,
//                   postal_code, area_level1, area_level2, area_level3,
//                   further_information?, tax_id_number?}
//     addressTo:   { ... mismos que from }
//     parcels: [{length, width, height, weight}]  // cm y kg — array porque Skydropx soporta multi
//     declaredValue: number MXN (para SOS)
//     insurance: bool (true default — SOS obligatorio por política)
//     packageType: código SAT (default '4G' = caja de cartón)
//     consignmentNote: código Carta Porte (default '50000000')
//     consignmentNoteContent: descripción del contenido
//     autoAdvance: bool (default true en sandbox — simula tracking auto
//                        para probar el webhook D.6 sin esperar al carrier)
//     printingFormat: 'standard' | 'thermal' (default 'standard')
//   }
const createShipment = async ({
  rateId,
  quotationId, // solo para logging/traceabilidad, no se envía a Skydropx
  addressFrom,
  addressTo,
  parcels,
  declaredValue,
  insurance = true,
  packageType = DEFAULT_PACKAGE_TYPE,
  consignmentNote = DEFAULT_CONSIGNMENT_NOTE,
  consignmentNoteContent,
  autoAdvance,
  printingFormat = 'standard',
}) => {
  if (!rateId) {
    throw new SkydropxQuoteError('rateId es requerido.');
  }
  if (!Array.isArray(parcels) || parcels.length === 0) {
    throw new SkydropxQuoteError('parcels debe ser un array con al menos un paquete.');
  }
  const token = await getAccessToken();

  // auto_advance simula la progresión tracking en sandbox; en prod se
  // ignora. Default: true si SKYDROPX_ENV=sandbox, false si producción.
  const isSandbox = (process.env.SKYDROPX_ENV || 'sandbox') === 'sandbox';
  const shouldAutoAdvance = typeof autoAdvance === 'boolean' ? autoAdvance : isSandbox;

  const packagesPayload = parcels.map((p, idx) => ({
    package_number: String(idx + 1),
    length: Number(p.length),
    width: Number(p.width),
    height: Number(p.height),
    weight: Number(p.weight),
    package_type: packageType,
    consignment_note: consignmentNote,
    // El seguro va POR PAQUETE en Skydropx, no global.
    package_protected: insurance,
    declared_value: Number(declaredValue),
    content: consignmentNoteContent,
  }));

  const body = {
    shipment: {
      rate_id: rateId,
      unique_shipment: true, // evita duplicados en reintentos (cache 96h)
      auto_advance: shouldAutoAdvance,
      printing_format: printingFormat,
      include_order_detail: true, // genera packing slip también (útil para el seller)
      address_from: { country_code: 'MX', ...addressFrom },
      address_to: { country_code: 'MX', ...addressTo },
      packages: packagesPayload,
    },
  };

  const res = await fetch(`https://${HOST}/api/v1/shipments`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    // XOLOLO: loguear el payload que mandamos + la respuesta cruda para
    // diagnosticar rechazos (rate_id caducado, colonia inválida, etc.)
    // sin depender de un round-trip con el usuario.
    // eslint-disable-next-line no-console
    console.error('[skydropx.createShipment] status=', res.status);
    // eslint-disable-next-line no-console
    console.error('[skydropx.createShipment] request body:', JSON.stringify(body));
    // eslint-disable-next-line no-console
    console.error('[skydropx.createShipment] response:', JSON.stringify(data));
    throw new SkydropxQuoteError(
      `Skydropx rechazó creación de envío (${res.status})`,
      data?.errors || data
    );
  }
  return data;
};

// XOLOLO: consultar un envío por id. La label_url se genera async
// después de crear el shipment, así que este helper hace polling hasta
// que aparezca (o hasta timeout). Se usa desde D.5 después de crear
// la guía para darle al seller el link del PDF que va a imprimir.
const getShipment = async (shipmentId, { poll = false, maxPollMs = 15000 } = {}) => {
  if (!shipmentId) throw new SkydropxQuoteError('shipmentId requerido.');
  const token = await getAccessToken();

  const fetchOnce = async () => {
    const r = await fetch(`https://${HOST}/api/v1/shipments/${shipmentId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const d = await r.json().catch(() => null);
    if (!r.ok) throw new SkydropxQuoteError(`GET shipment falló (${r.status})`, d);
    return d;
  };

  if (!poll) return fetchOnce();

  const start = Date.now();
  while (Date.now() - start < maxPollMs) {
    const data = await fetchOnce();
    // Buscar label_url en la data + included (Skydropx retorna
    // JSON:API-style con paquetes en `included`).
    const shipmentAttrs = data?.data?.attributes || {};
    const pkgs = (data?.included || []).filter(i => i.type === 'package');
    const labelReady =
      shipmentAttrs.label_url ||
      pkgs.some(p => p.attributes?.label_url);
    if (labelReady) return data;
    await new Promise(r => setTimeout(r, 1500));
  }
  throw new SkydropxTimeoutError(
    `label_url no disponible después de ${maxPollMs}ms para shipment ${shipmentId}`
  );
};

module.exports = {
  getAccessToken,
  getQuotationRates,
  createShipment,
  getShipment,
  SkydropxAuthError,
  SkydropxQuoteError,
  SkydropxTimeoutError,
  SOS_INSURANCE_MXN,
  XOLOLO_MARGIN_PCT,
};
