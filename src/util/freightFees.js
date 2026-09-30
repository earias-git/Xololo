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

export const computeFreightBreakdown = fleteSubunits => {
  const flete = Number(fleteSubunits) || 0;
  const motorCobro = round(flete * PCT_MOTOR);
  const ivaMotor = round(motorCobro * PCT_IVA);
  const xololoAdmin = FIXED_XOLOLO_SUBUNITS;
  const ivaXololoAdmin = round(xololoAdmin * PCT_IVA);
  const totalFees = motorCobro + ivaMotor + xololoAdmin + ivaXololoAdmin;
  const sellerReceives = flete - totalFees;
  return {
    fleteSubunits: flete,             // Buyer paga esto (= cotización del seller)
    motorCobroSubunits: motorCobro,
    ivaMotorSubunits: ivaMotor,
    xololoAdminSubunits: xololoAdmin,
    ivaXololoAdminSubunits: ivaXololoAdmin,
    totalFeesSubunits: totalFees,
    sellerReceivesSubunits: sellerReceives,
    // Alias legacy — antes 'totalSubunits' era el total con fees
    // sumados; ahora buyer paga sólo el flete, así que apunta al flete
    // para no romper consumidores viejos.
    totalSubunits: flete,
    labels: {
      motorCobro: `${(PCT_MOTOR * 100).toFixed(1)}% + IVA`,
      xololoAdmin: `$${(FIXED_XOLOLO_SUBUNITS / 100).toFixed(2)} + IVA`,
    },
  };
};
