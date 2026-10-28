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

const crypto = require('crypto');

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
// - SOS Protección Skydropx: SIEMPRE lo cotiza Skydropx y lo expone
//   en el rate (total_value_with_protection / protection_value_total).
//   Nunca inventamos la fórmula localmente. Si Skydropx no expuso el
//   costo, el rate se marca como no asegurable (insurable=false al UI).
// - Utilidad Xololo: 12.5% sobre el bruto Skydropx (guía + SOS si lo
//   hay). Unificado con el flujo público de venta de guías.
// Fórmula: precio_público = (rate_skydropx + sos_real) × 1.125
//          · sos_real = 0 si el buyer no contrató seguro.
//          · sos_real = costo que Skydropx devuelve cuando cotizamos
//            con package_protected=true + declared_value.
// Nota UI: nunca mostrar al buyer el "+12.5%" ni el breakdown. Sólo
// el total final cotizado.
const XOLOLO_MARGIN_PCT = 0.125;

// XOLOLO 2026-10-27: HMAC para firmar los rates que mandamos al cliente.
// Al momento del initiate, el server re-firma los campos recibidos y
// compara. Si el cliente alteró rate.total (o cualquier otro) en
// devtools, el HMAC no coincide y rechazamos la transacción.
// Costo: 0 (solo crypto local). Beneficio: cierra money-leak directo.
//
// Secret: usa SHIPPING_RATE_SECRET si está, con fallback a
// OPERATOR_SESSION_SECRET. En desarrollo cae a un valor por defecto
// solo para no romper el servidor local.
const getRateSecret = () =>
  process.env.SHIPPING_RATE_SECRET ||
  process.env.OPERATOR_SESSION_SECRET ||
  'xololo-dev-only-not-for-prod';

// XOLOLO 2026-10-27: rotación. Durante el periodo de rotación, acepta
// firmas hechas con el secreto previo (SHIPPING_RATE_SECRET_PREV) hasta
// que caduquen por TTL (30 min).
const getRateVerifySecrets = () => {
  const current = getRateSecret();
  const prev = process.env.SHIPPING_RATE_SECRET_PREV;
  const list = [current];
  if (prev && prev !== current) list.push(prev);
  return list;
};

// Campos que el HMAC cubre. Si alguno cambia, la firma no coincide.
// Timestamp evita replay con rate viejo (válido 30 min).
const RATE_SIGNATURE_TTL_MS = 30 * 60 * 1000;

const signRate = (rate, quotationId) => {
  const issuedAt = Date.now();
  const payload = [
    rate.id,
    quotationId,
    Number(rate.total).toFixed(2),
    Number(rate.insuranceCostReal || 0).toFixed(2),
    Number(rate.shippingFeePublic || rate.total).toFixed(2),
    Number(rate.insuranceTotalPublic || 0).toFixed(2),
    rate.currency || 'MXN',
    issuedAt,
  ].join('|');
  const hmac = crypto
    .createHmac('sha256', getRateSecret())
    .update(payload)
    .digest('hex');
  return { signature: hmac, issuedAt };
};

// Verifica la firma de un rate recibido del cliente. Devuelve
// { valid: boolean, reason?: string }. El cliente debe enviar
// rate.signature + rate.signatureIssuedAt tal y como el server se los
// dio al cotizar.
const verifyRateSignature = (rate, quotationId) => {
  if (!rate?.signature || !rate?.signatureIssuedAt) {
    return { valid: false, reason: 'missing_signature' };
  }
  const age = Date.now() - Number(rate.signatureIssuedAt);
  if (!Number.isFinite(age) || age < 0 || age > RATE_SIGNATURE_TTL_MS) {
    return { valid: false, reason: 'signature_expired' };
  }
  const payload = [
    rate.id,
    quotationId,
    Number(rate.total).toFixed(2),
    Number(rate.insuranceCostReal || 0).toFixed(2),
    Number(rate.shippingFeePublic || rate.total).toFixed(2),
    Number(rate.insuranceTotalPublic || 0).toFixed(2),
    rate.currency || 'MXN',
    Number(rate.signatureIssuedAt),
  ].join('|');
  // Prueba con cada secreto (actual + previo durante rotación).
  const a = Buffer.from(rate.signature, 'hex');
  for (const secret of getRateVerifySecrets()) {
    const expected = crypto
      .createHmac('sha256', secret)
      .update(payload)
      .digest('hex');
    const b = Buffer.from(expected, 'hex');
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) {
      return { valid: true };
    }
  }
  return { valid: false, reason: 'signature_mismatch' };
};

// XOLOLO Junta 2026-10-26 §5: carriers que NO recolectan en domicilio.
// Skydropx confirmó que estos son "sólo drop-off en sucursal" — no
// agendan pickup aunque el seller lo pida.
// Match case-insensitive contra provider_name o provider_display_name.
const CARRIERS_WITHOUT_PICKUP = new Set([
  'jt_express',
  'jyt',
  'j&t',
  'jt express',
  '99min',
  '99minutos',
  '99_min',
  '99 minutos',
]);

const isDropoffOnlyCarrier = rate => {
  const code = String(rate?.provider_name || '')
    .toLowerCase()
    .replace(/[\s_-]/g, '');
  const name = String(rate?.provider_display_name || '')
    .toLowerCase()
    .replace(/[\s_-]/g, '');
  for (const needle of CARRIERS_WITHOUT_PICKUP) {
    const n = needle.toLowerCase().replace(/[\s_-]/g, '');
    if (code === n || name === n || code.includes(n) || name.includes(n)) return true;
  }
  return false;
};

const applyPricingPolicy = (skydropxTotalMXN, sosCostMXN = 0) => {
  const base = Number(skydropxTotalMXN) || 0;
  const sos = Number(sosCostMXN) || 0;
  const bruto = base + sos;
  const totalPublico = bruto * (1 + XOLOLO_MARGIN_PCT);
  return {
    skydropxTotal: base,
    sosInsurance: Number(sos.toFixed(2)),
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
const getQuotationRates = async ({ from, to, parcel, insurance = false, declaredValue = 0 }) => {
  const token = await getAccessToken();

  // XOLOLO Bug 2a: log del parcel + destino para poder auditar por qué
  // Skydropx devuelve tal o cual precio. Los usuarios reportan tarifas
  // "altas" — con este log el operador ve dimensiones/peso/ruta y puede
  // sanity-check contra Skydropx dashboard.
  // eslint-disable-next-line no-console
  console.log(
    `[skydropx.quote] parcel L=${parcel?.length}cm W=${parcel?.width}cm H=${parcel?.height}cm ` +
      `weight=${parcel?.weight}kg | ${from?.postal_code} → ${to?.postal_code}` +
      (to?.street1 ? ` | street1="${String(to.street1).slice(0, 40)}"` : '') +
      (insurance ? ` | insurance=true declaredValue=${declaredValue}` : '')
  );

  // XOLOLO: si pedimos seguro, Skydropx devuelve el costo real en los
  // campos protection_value_total / total_value_with_protection / etc.
  // Para que esos campos aparezcan en el response, el parcel tiene que
  // incluir package_protected + declared_value. Esto reemplaza el
  // hardcoded de $25 por el precio real por carrier.
  const parcelPayload = insurance
    ? {
        ...parcel,
        package_protected: true,
        declared_value: Number(declaredValue) || 0,
      }
    : parcel;

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
        parcel: parcelPayload,
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
      throw new SkydropxQuoteError(`Polling de cotización falló (${pollRes.status})`, last);
    }
  }

  if (!last.is_completed) {
    throw new SkydropxTimeoutError(`Cotización ${quotationId} no completó en ${MAX_POLL_MS}ms`);
  }

  // XOLOLO: contabilizamos también los rates fallidos (success:false)
  // para poder decirle al buyer "N paqueterías no respondieron para esta
  // combinación" y loguear los motivos para debug en Render.
  const failedRatesSummary = (last.rates || [])
    .filter(r => !r.success)
    .map(r => ({
      carrier: r.provider_display_name || r.provider_name,
      service: r.provider_service_name,
      reason: r.error_messages?.[0] || r.message || r.error || 'sin detalle',
    }));
  if (failedRatesSummary.length > 0) {
    // eslint-disable-next-line no-console
    console.log('[skydropx.quote] failed rates:', JSON.stringify(failedRatesSummary));
  }

  const successRates = (last.rates || [])
    .filter(r => r.success)
    .map(r => {
      // XOLOLO: Skydropx devuelve el costo real del seguro en varios
      // campos posibles según versión de API. Si vino
      // total_value_with_protection usamos la diferencia; si no, caemos
      // al campo directo. Si no se pidió seguro → 0.
      const totalWithProtection =
        Number(r.total_value_with_protection) || Number(r.total_with_protection) || null;
      const protectionTotal =
        Number(r.protection_value_total) || Number(r.protection_total) || null;
      let insuranceCostReal = 0;
      let insuranceAvailable = false;
      if (insurance) {
        if (totalWithProtection && totalWithProtection > Number(r.total)) {
          insuranceCostReal = Number((totalWithProtection - Number(r.total)).toFixed(2));
          insuranceAvailable = true;
        } else if (protectionTotal) {
          insuranceCostReal = Number(protectionTotal.toFixed(2));
          insuranceAvailable = true;
        }
        // XOLOLO Fase 2: NO calculamos fórmula local. Si Skydropx no
        // devolvió el costo del seguro para este rate, lo marcamos como
        // no asegurable y la UI lo oculta como opción con seguro. Esto
        // evita cobrarle al buyer un seguro que no vamos a contratar.
        if (!insuranceAvailable) {
          // eslint-disable-next-line no-console
          console.warn(
            `[skydropx.quote] rate ${r.provider_display_name} ${r.provider_service_name}: ` +
              `pedimos seguro pero Skydropx no expuso costo (insurable=${r.insurable})`
          );
        }
      }

      // XOLOLO: pricing con SOS real (0 si el buyer no contrató seguro).
      const pricing = applyPricingPolicy(Number(r.total), insuranceCostReal);
      // XOLOLO Junta 2026-10-26: expone el total POST-margen Xololo del
      // seguro para que el breakdown pueda renderizarlo como línea
      // separada "shipping-insurance". Si no hay seguro = 0.
      const insuranceTotalPublic = Number((insuranceCostReal * (1 + XOLOLO_MARGIN_PCT)).toFixed(2));
      // Y el total de envío sin seguro (ya con margen) para la línea
      // "shipping-fee". shippingFee + insuranceTotal = totalPublico.
      const shippingFeePublic = Number((pricing.totalPublico - insuranceTotalPublic).toFixed(2));

      // XOLOLO Bug 2a: log del breakdown por rate para poder rastrear
      // "por qué salió $X" — Skydropx neto + SOS + margen = precio público.
      // eslint-disable-next-line no-console
      console.log(
        `[skydropx.rate] ${r.provider_display_name} ${r.provider_service_name}: ` +
          `skydropx=$${pricing.skydropxTotal} +SOS=$${pricing.sosInsurance} ` +
          `+margin=$${pricing.xololoMargin} → público=$${pricing.totalPublico}` +
          (insurance ? ` | insurable=${r.insurable}` : ' | sin seguro')
      );
      return {
        id: r.id,
        carrier: r.provider_display_name,
        carrierCode: r.provider_name,
        service: r.provider_service_name,
        serviceCode: r.provider_service_code,
        total: pricing.totalPublico,
        currency: r.currency_code || 'MXN',
        days: r.days,
        pickup: r.pickup && !isDropoffOnlyCarrier(r),
        officeDelivery: r.office_delivery,
        // XOLOLO Junta 2026-10-26: true si el carrier sólo acepta
        // drop-off en sucursal (no agenda recolección). El UI muestra
        // un badge y oculta la opción de pickup para estos.
        dropoffOnly: isDropoffOnlyCarrier(r),
        pricing,
        // Para el flujo de guías públicas (#28): costo real del seguro
        // que devolvió Skydropx. Null si no pedimos seguro o si la API
        // no expuso el campo (caso edge, caemos a hardcoded).
        insurable: r.insurable,
        insuranceCostReal,
        // XOLOLO Fase 2: true cuando pedimos seguro Y Skydropx devolvió
        // el costo real. Si false y pedimos seguro, el UI debe caer a
        // "sin seguro" y avisar al buyer que no se puede asegurar.
        insuranceAvailable,
        // XOLOLO Junta 2026-10-26: desglose público para que lineItems
        // emita 2 líneas separadas en el breakdown (shipping-fee +
        // shipping-insurance). Siempre: shippingFeePublic +
        // insuranceTotalPublic = total.
        insuranceTotalPublic,
        shippingFeePublic,
      };
    })
    .map(r => {
      // XOLOLO 2026-10-27: firma HMAC para evitar manipulación del
      // precio en el cliente (devtools).
      const { signature, issuedAt } = signRate(r, quotationId);
      return { ...r, signature, signatureIssuedAt: issuedAt };
    })
    .sort((a, b) => a.total - b.total);

  return {
    quotationId,
    rates: successRates,
    unavailableCount: failedRatesSummary.length,
    // Carriers que no respondieron (dedupe por nombre). Útil para que
    // la UI diga "FedEx y DHL no respondieron" sin exponer detalles.
    unavailableCarriers: Array.from(
      new Set(failedRatesSummary.map(f => f.carrier).filter(Boolean))
    ),
  };
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
    // XOLOLO: loguear la respuesta cruda de Skydropx siempre — trae los
    // detalles del rechazo (rate_id caducado, colonia inválida, weight
    // fuera de rango, etc.) y NO contiene PII del buyer/seller. El
    // request body sí trae PII (nombre, teléfono, dirección) así que
    // sólo lo loguemos cuando SKYDROPX_DEBUG=true está seteado.
    // eslint-disable-next-line no-console
    console.error('[skydropx.createShipment] status=', res.status);
    // eslint-disable-next-line no-console
    console.error('[skydropx.createShipment] response:', JSON.stringify(data));
    if (process.env.SKYDROPX_DEBUG === 'true') {
      // eslint-disable-next-line no-console
      console.error('[skydropx.createShipment] request body:', JSON.stringify(body));
    }
    throw new SkydropxQuoteError(
      `Skydropx rechazó creación de envío (${res.status})`,
      data?.errors || data
    );
  }
  // XOLOLO: nuestro código asume que Skydropx cobra $25 fijo por el SOS
  // Protección (política comercial documentada en docs/LOGISTICS_V1.md §5),
  // pero la API no lo devuelve explícitamente en la cotización. Logueamos
  // AQUÍ todos los campos de precio de la respuesta real al crear el
  // shipment para verificar contra factura y poder reconciliar si cambia.
  // Si Skydropx cobra distinto, nuestro margen del 12.5% público queda
  // descuadrado. Grep de logs: "[skydropx.createShipment.pricing]"
  try {
    const shipment = data?.data || data?.shipment || data;
    const pricingSnapshot = {
      shipment_id: shipment?.id,
      total_pricing: shipment?.total_pricing || shipment?.attributes?.total_pricing,
      rate_total: shipment?.rate?.total || shipment?.attributes?.rate?.total,
      service_pricing: shipment?.service_pricing || shipment?.attributes?.service_pricing,
      insurance_cost:
        shipment?.insurance_cost ||
        shipment?.attributes?.insurance_cost ||
        shipment?.package_insurance_cost,
      // Capturamos cualquier campo que contenga la palabra 'price',
      // 'cost', 'total' o 'insurance' para no perder breakdown útil.
      _rawKeys:
        shipment && typeof shipment === 'object'
          ? Object.keys(shipment).filter(k => /price|cost|total|insurance|protection/i.test(k))
          : [],
    };
    // eslint-disable-next-line no-console
    console.log('[skydropx.createShipment.pricing]', JSON.stringify(pricingSnapshot));
  } catch (_e) {
    // El log nunca debe tumbar el flujo real.
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
    const labelReady = shipmentAttrs.label_url || pkgs.some(p => p.attributes?.label_url);
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
  XOLOLO_MARGIN_PCT,
  verifyRateSignature,
};
