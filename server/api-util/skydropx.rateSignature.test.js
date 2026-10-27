// Tests del HMAC de shipping rates. Vive aparte de skydropx.test.js
// porque la lógica es pura y no requiere mocks de fetch.
const { verifyRateSignature } = require('./skydropx');

// Replica interna de signRate para generar fixtures firmados en el test.
// En producción el rate llega firmado desde getQuotationRates.
const crypto = require('crypto');
const getRateSecret = () =>
  process.env.SHIPPING_RATE_SECRET ||
  process.env.OPERATOR_SESSION_SECRET ||
  'xololo-dev-only-not-for-prod';

const signRateForTest = (rate, quotationId, issuedAt = Date.now()) => {
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
  const signature = crypto
    .createHmac('sha256', getRateSecret())
    .update(payload)
    .digest('hex');
  return { ...rate, signature, signatureIssuedAt: issuedAt };
};

describe('verifyRateSignature', () => {
  const baseRate = {
    id: 'rate-abc-123',
    total: 150.5,
    insuranceCostReal: 20,
    shippingFeePublic: 130.5,
    insuranceTotalPublic: 22.5,
    currency: 'MXN',
  };
  const quotationId = 'quot-xyz-789';

  it('acepta una firma correcta recién emitida', () => {
    const signed = signRateForTest(baseRate, quotationId);
    expect(verifyRateSignature(signed, quotationId).valid).toBe(true);
  });

  it('rechaza si falta signature', () => {
    const r = verifyRateSignature(baseRate, quotationId);
    expect(r.valid).toBe(false);
    expect(r.reason).toBe('missing_signature');
  });

  it('rechaza si falta signatureIssuedAt', () => {
    const signed = signRateForTest(baseRate, quotationId);
    delete signed.signatureIssuedAt;
    expect(verifyRateSignature(signed, quotationId).reason).toBe('missing_signature');
  });

  it('rechaza si el atacante bajó el total', () => {
    const signed = signRateForTest(baseRate, quotationId);
    signed.total = 5; // tamper
    expect(verifyRateSignature(signed, quotationId).reason).toBe('signature_mismatch');
  });

  it('rechaza si cambia el rate.id', () => {
    const signed = signRateForTest(baseRate, quotationId);
    signed.id = 'rate-other';
    expect(verifyRateSignature(signed, quotationId).reason).toBe('signature_mismatch');
  });

  it('rechaza si el quotationId no coincide', () => {
    const signed = signRateForTest(baseRate, quotationId);
    expect(verifyRateSignature(signed, 'quot-other').reason).toBe('signature_mismatch');
  });

  it('rechaza si el issuedAt es viejo (>30 min)', () => {
    const old = Date.now() - 31 * 60 * 1000;
    const signed = signRateForTest(baseRate, quotationId, old);
    expect(verifyRateSignature(signed, quotationId).reason).toBe('signature_expired');
  });

  it('rechaza si issuedAt es futuro (clock skew o tamper)', () => {
    const future = Date.now() + 60 * 1000;
    const signed = signRateForTest(baseRate, quotationId, future);
    expect(verifyRateSignature(signed, quotationId).reason).toBe('signature_expired');
  });

  it('rechaza si cambia insuranceCostReal', () => {
    const signed = signRateForTest(baseRate, quotationId);
    signed.insuranceCostReal = 0;
    expect(verifyRateSignature(signed, quotationId).reason).toBe('signature_mismatch');
  });

  it('rechaza firma con longitud distinta (no crashea timingSafeEqual)', () => {
    const signed = signRateForTest(baseRate, quotationId);
    signed.signature = 'abc123'; // 6 chars != 64
    expect(verifyRateSignature(signed, quotationId).reason).toBe('signature_mismatch');
  });
});
