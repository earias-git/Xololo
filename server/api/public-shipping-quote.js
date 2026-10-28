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

// Seguro: Skydropx SÍ devuelve el precio real en la cotización cuando
// se le pasa package_protected + declared_value (ver getQuotationRates
// en skydropx.js — campo insuranceCostReal por rate). Usamos ese valor
// cuando esté disponible; si por alguna razón la API no lo expone,
// caemos a $25 fijo (política documentada en LOGISTICS_V1.md §5).
// Cobertura máxima: $100,000 (confirmar con Skydropx si cambia).
const INSURANCE_FLAT_FALLBACK_MXN = 25;
const INSURANCE_MAX_COVERAGE_MXN = 100000;

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
      return res
        .status(400)
        .json({ error: 'invalid_request', details: 'from.postal_code debe ser 5 dígitos.' });
    }
    if (!validatePostalCode(to?.postal_code)) {
      return res
        .status(400)
        .json({ error: 'invalid_request', details: 'to.postal_code debe ser 5 dígitos.' });
    }
    const parcelErr = validateParcel(parcel);
    if (parcelErr) {
      return res.status(400).json({ error: 'invalid_request', details: parcelErr });
    }

    const dv = Number(declaredValue) || 0;
    const coverageExceeded = includeInsurance && dv > INSURANCE_MAX_COVERAGE_MXN;

    // Pedimos a Skydropx el precio real del seguro (campo
    // insuranceCostReal por rate). Si no lo pedimos (includeInsurance=false)
    // el rate.insuranceCostReal viene null y no sumamos nada.
    const { rates, quotationId, unavailableCount, unavailableCarriers } = await getQuotationRates({
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
      insurance: !!includeInsurance,
      declaredValue: dv,
    });

    // Aplicamos el margen a cada rate. El costo del seguro usado es:
    //   1. El que devolvió Skydropx si existe (preferido, real por carrier)
    //   2. Fallback a $25 fijo si el campo no vino (política documentada)
    // SÓLO exponemos el total público al buyer; el breakdown va a logs
    // internos para analytics/ledger.
    const buyerFacingRates = (rates || []).map(r => {
      // ⚠️ Nota: getQuotationRates ya aplicó internamente la "política
      // de seller" (SOS obligatorio $25 + 14% margen) encima del total
      // Skydropx raw. Para el flujo público usamos el rate RAW de
      // Skydropx (r.pricing.skydropxTotal) y aplicamos nuestras propias
      // reglas (12.5% + seguro opcional real) por separado.
      const skydropxRaw = Number(r.pricing?.skydropxTotal) || Number(r.total) || 0;
      const insReal = includeInsurance
        ? Number(r.insuranceCostReal) || INSURANCE_FLAT_FALLBACK_MXN
        : 0;
      const breakdown = applyPublicMargin(skydropxRaw, insReal);
      // Log para analytics (F6) y para verificar precio real del seguro.
      // eslint-disable-next-line no-console
      console.log(
        '[public-shipping-quote]',
        JSON.stringify({
          carrier: r.carrier,
          service: r.service,
          skydropxTotal: breakdown.skydropxRate,
          insuranceSource: includeInsurance
            ? r.insuranceCostReal != null
              ? 'skydropx-api'
              : 'fallback-25'
            : 'none',
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
        insuranceAvailable: !!r.insurable,
        insurancePrice: includeInsurance ? Number((insReal * (1 + 0.125)).toFixed(2)) : null,
      };
    });

    // Precio promedio del seguro (público) a mostrar en el encabezado —
    // en el caso típico todos los carriers cobran lo mismo, pero si
    // varían, enseñamos el min para no sorprender al buyer.
    const insuranceSamples = buyerFacingRates
      .map(r => r.insurancePrice)
      .filter(v => typeof v === 'number' && v > 0);
    const insuranceDisplayPrice = insuranceSamples.length > 0 ? Math.min(...insuranceSamples) : 0;

    return res.json({
      quotationId,
      rates: buyerFacingRates,
      insurance: {
        included: !!includeInsurance,
        price: insuranceDisplayPrice,
        maxCoverage: INSURANCE_MAX_COVERAGE_MXN,
        coverageExceeded,
      },
      // XOLOLO: paqueterías que Skydropx no respondió para esta
      // combinación — para que la UI pueda mencionar que faltan.
      unavailableCount: unavailableCount || 0,
      unavailableCarriers: unavailableCarriers || [],
    });
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
