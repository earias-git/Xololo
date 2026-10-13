// XOLOLO · Cotizador PÚBLICO de guías de paquetería (feature #28).
//
// Entry point sin login para que cualquier persona (seller o no) obtenga
// una cotización de envío con precio Xololo (12.5% sobre Skydropx + seguro
// opcional). F1: solo cotización, sin compra. La compra end-to-end llega
// en F2.
//
// Contrato:
//   POST /api/public-shipping-quote
//   Body: {
//     from: { postal_code (5 dig) },
//     to:   { postal_code (5 dig) },
//     parcel: { weight (kg), length, width, height (cm) },
//     declaredValue?: number (MXN, para calcular seguro opcional)
//     includeInsurance?: boolean (default false)
//   }
//   200 → {
//     quotationId,
//     rates: [{
//       id, carrier, carrierCode, service, serviceCode, days,
//       publicTotal, currency,         // ← lo que ve el buyer
//       insuranceAvailable, insurancePrice (si se pidió)
//     }]
//   }
//   400 → { error: 'invalid_request', details }
//   422 → { error: 'quote_failed', details }
//   500 → { error: 'internal' }
//
// NO exponemos skydropxRate ni el breakdown del margen al buyer: la
// respuesta omite esos campos. El breakdown vive sólo en logs internos.

const {
  getQuotationRates,
  SkydropxAuthError,
  SkydropxQuoteError,
  SkydropxTimeoutError,
} = require('../api-util/skydropx');
const { applyPublicMargin } = require('../api-util/xololoPublicPricing');

const DEFAULT_AREAS = {
  area_level1: 'México',
  area_level2: 'México',
  area_level3: 'Centro',
};

// Seguro: para F1 usamos un modelo simple 2% del valor declarado con
// mínimo $30 MXN. En F2 lo reemplazamos por el endpoint real de
// Skydropx insurance quote cuando el user esté por comprar. Por ahora
// esto es suficiente para que el buyer vea un número aproximado.
const PLACEHOLDER_INSURANCE_MIN = 30;
const PLACEHOLDER_INSURANCE_PCT = 0.02;
const computePlaceholderInsurance = declaredValue => {
  const dv = Number(declaredValue) || 0;
  if (dv <= 0) return 0;
  return Math.max(PLACEHOLDER_INSURANCE_MIN, Math.round(dv * PLACEHOLDER_INSURANCE_PCT));
};

const validatePostalCode = cp => /^\d{5}$/.test(String(cp || ''));

const validateParcel = p => {
  if (!p || typeof p !== 'object') return 'parcel requerido.';
  const nums = ['weight', 'length', 'width', 'height'];
  for (const k of nums) {
    const v = Number(p[k]);
    if (!Number.isFinite(v) || v <= 0) return `parcel.${k} debe ser > 0.`;
    if (v > 1000) return `parcel.${k} fuera de rango (max 1000).`;
  }
  return null;
};

module.exports = async (req, res) => {
  try {
    const { from, to, parcel, declaredValue, includeInsurance } = req.body || {};
    if (!validatePostalCode(from?.postal_code)) {
      return res.status(400).json({ error: 'invalid_request', details: 'from.postal_code debe ser 5 dígitos.' });
    }
    if (!validatePostalCode(to?.postal_code)) {
      return res.status(400).json({ error: 'invalid_request', details: 'to.postal_code debe ser 5 dígitos.' });
    }
    const parcelErr = validateParcel(parcel);
    if (parcelErr) {
      return res.status(400).json({ error: 'invalid_request', details: parcelErr });
    }

    const insurancePrice = includeInsurance ? computePlaceholderInsurance(declaredValue) : 0;

    const { rates, quotationId } = await getQuotationRates({
      from: {
        postal_code: String(from.postal_code),
        area_level1: from.area_level1 || DEFAULT_AREAS.area_level1,
        area_level2: from.area_level2 || DEFAULT_AREAS.area_level2,
        area_level3: from.area_level3 || DEFAULT_AREAS.area_level3,
      },
      to: {
        postal_code: String(to.postal_code),
        area_level1: to.area_level1 || DEFAULT_AREAS.area_level1,
        area_level2: to.area_level2 || DEFAULT_AREAS.area_level2,
        area_level3: to.area_level3 || DEFAULT_AREAS.area_level3,
      },
      parcel: {
        weight: Number(parcel.weight),
        length: Number(parcel.length),
        width: Number(parcel.width),
        height: Number(parcel.height),
      },
    });

    // Aplicamos el margen a cada rate. SÓLO exponemos el total público
    // al buyer; el breakdown va a logs internos para analytics/ledger.
    const buyerFacingRates = (rates || []).map(r => {
      const skydropxTotal = Number(r.total) || 0;
      const breakdown = applyPublicMargin(skydropxTotal, insurancePrice);
      // Log para analytics futuros (F6).
      // eslint-disable-next-line no-console
      console.log(
        '[public-shipping-quote]',
        JSON.stringify({
          carrier: r.carrier,
          service: r.service,
          skydropxTotal: breakdown.skydropxRate,
          insurance: breakdown.insurance,
          margin: breakdown.xololoMargin,
          publicTotal: breakdown.publicTotal,
        })
      );
      return {
        id: r.id,
        carrier: r.carrier,
        carrierCode: r.carrierCode,
        service: r.service,
        serviceCode: r.serviceCode,
        days: r.days,
        publicTotal: breakdown.publicTotal,
        currency: 'MXN',
        insuranceAvailable: true,
        insurancePrice: includeInsurance ? breakdown.insurance : null,
      };
    });

    return res.json({ quotationId, rates: buyerFacingRates });
  } catch (e) {
    if (e instanceof SkydropxAuthError) {
      // eslint-disable-next-line no-console
      console.error('public-shipping-quote SkydropxAuthError:', e.message);
      return res.status(500).json({ error: 'internal' });
    }
    if (e instanceof SkydropxQuoteError) {
      return res.status(422).json({ error: 'quote_failed', details: e.details || e.message });
    }
    if (e instanceof SkydropxTimeoutError) {
      return res.status(504).json({ error: 'quote_timeout', details: e.message });
    }
    // eslint-disable-next-line no-console
    console.error('public-shipping-quote unexpected error:', e);
    return res.status(500).json({ error: 'internal' });
  }
};
