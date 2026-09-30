// XOLOLO Envíos v2 · Freight: cálculo del desglose de fees que se
// DESCUENTAN al seller sobre el monto del flete cotizado.
//
// Fórmulas (definidas con earias):
//   flete             = quotedAmount (cotización del seller = lo que paga el buyer)
//   motorCobro        = flete * 3.6%           (Stripe processing fee, variable)
//   ivaMotor          = motorCobro * 16%
//   xololoAdmin       = $14.00 MXN fijo        (servicio administrativo Xololo)
//   ivaXololoAdmin    = xololoAdmin * 16%
//   BUYER PAGA        = flete (exacto, sin cargos adicionales)
//   SELLER RECIBE     = flete − motorCobro − ivaMotor − xololoAdmin − ivaXololoAdmin
//
// Xololo cubre la diferencia del fee real de Stripe (que se calcula
// sobre el total capturado). Aceptable para v1.
//
// Todos los montos en subunits (centavos MXN).

const PCT_MOTOR = 0.036; // 3.6%
const FIXED_XOLOLO_SUBUNITS = 1400; // $14.00 MXN fijo
const PCT_IVA = 0.16; // 16%

// Redondea al centavo (integer subunits).
const round = n => Math.round(n);

// XOLOLO: retenciones fiscales — se activan cuando integremos Facturama.
// Por ahora se calculan siempre en 0; el shape queda listo para no
// romper consumidores cuando se conecten las tasas reales por seller.
//
// Reglas planeadas (SAT):
//   - Ret. ISR: 1% / 2.5% / 4% / 0% según tipo de constancia SAT del seller.
//     Se aplica ANTES de IVA y sólo a Personas Físicas (no Morales).
//   - Ret. IVA 50%: sobre el IVA del ingreso, para Personas Físicas
//     que sí tienen constancia SAT.
//   - Ret. IVA 100%: sobre el IVA, para Personas Físicas sin constancia.
//   - Personas Morales: no aplica retención.
//
// TODO Facturama: leer sellerTaxProfile del user (constancia? física/moral?)
// y pasarlo como 2do arg a este helper.
const computeRetenciones = (fleteSubunits, sellerTaxProfile = null) => {
  // Placeholder — hasta la integración con Facturama.
  return {
    retIsrSubunits: 0,
    retIvaSubunits: 0,
    retIsrPct: 0,
    retIvaPct: 0,
  };
};

export const computeFreightBreakdown = (fleteSubunits, sellerTaxProfile = null) => {
  const flete = Number(fleteSubunits) || 0;
  const motorCobro = round(flete * PCT_MOTOR);
  const ivaMotor = round(motorCobro * PCT_IVA);
  const xololoAdmin = FIXED_XOLOLO_SUBUNITS;
  const ivaXololoAdmin = round(xololoAdmin * PCT_IVA);
  const { retIsrSubunits, retIvaSubunits, retIsrPct, retIvaPct } = computeRetenciones(
    flete,
    sellerTaxProfile
  );
  const totalFees = motorCobro + ivaMotor + xololoAdmin + ivaXololoAdmin;
  const totalRetenciones = retIsrSubunits + retIvaSubunits;
  const sellerReceives = flete - totalFees - totalRetenciones;
  return {
    fleteSubunits: flete,             // Buyer paga esto (= cotización del seller)
    motorCobroSubunits: motorCobro,
    ivaMotorSubunits: ivaMotor,
    xololoAdminSubunits: xololoAdmin,
    ivaXololoAdminSubunits: ivaXololoAdmin,
    // Retenciones fiscales (0 hasta Facturama).
    retIsrSubunits,
    retIvaSubunits,
    retIsrPct,
    retIvaPct,
    totalFeesSubunits: totalFees,
    totalRetencionesSubunits: totalRetenciones,
    sellerReceivesSubunits: sellerReceives,
    // Alias legacy — antes 'totalSubunits' era el total con fees
    // sumados; ahora buyer paga sólo el flete, así que apunta al flete
    // para no romper consumidores viejos.
    totalSubunits: flete,
    labels: {
      motorCobro: `${(PCT_MOTOR * 100).toFixed(1)}% + IVA`,
      xololoAdmin: `$${(FIXED_XOLOLO_SUBUNITS / 100).toFixed(2)} + IVA`,
      retIsr: retIsrPct > 0 ? `${(retIsrPct * 100).toFixed(1)}%` : null,
      retIva: retIvaPct > 0 ? `${(retIvaPct * 100).toFixed(0)}% del IVA` : null,
    },
  };
};
