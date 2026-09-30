// XOLOLO Envíos v2 · Freight: cálculo del desglose de fees que el
// buyer paga sobre el monto del flete cotizado por el seller.
//
// Fórmulas (definidas con earias):
//   flete             = quotedAmount (cotización del seller)
//   motorCobro        = flete * 3.6%      (Stripe processing fee)
//   ivaMotor          = motorCobro * 16%
//   xololoAdmin       = flete * 14%       (servicio administrativo Xololo)
//   ivaXololoAdmin    = xololoAdmin * 16%
//   TOTAL BUYER PAGA  = flete + motorCobro + ivaMotor + xololoAdmin + ivaXololoAdmin
//
// El seller recibe la base (flete completa). Xololo cubre la diferencia
// del fee de Stripe sobre el total real cobrado (aproximación aceptable
// para v1; en v2 se puede recalcular sobre el TOTAL).
//
// Todos los montos en subunits (centavos MXN).

const PCT_MOTOR = 0.036; // 3.6%
const PCT_XOLOLO = 0.14; // 14%
const PCT_IVA = 0.16; // 16%

// Redondea al centavo (integer subunits).
const round = n => Math.round(n);

export const computeFreightBreakdown = fleteSubunits => {
  const flete = Number(fleteSubunits) || 0;
  const motorCobro = round(flete * PCT_MOTOR);
  const ivaMotor = round(motorCobro * PCT_IVA);
  const xololoAdmin = round(flete * PCT_XOLOLO);
  const ivaXololoAdmin = round(xololoAdmin * PCT_IVA);
  const total = flete + motorCobro + ivaMotor + xololoAdmin + ivaXololoAdmin;
  return {
    fleteSubunits: flete,
    motorCobroSubunits: motorCobro,
    ivaMotorSubunits: ivaMotor,
    xololoAdminSubunits: xololoAdmin,
    ivaXololoAdminSubunits: ivaXololoAdmin,
    totalSubunits: total,
    // Meta útil para UI ("14% + IVA", "3.6% + IVA").
    labels: {
      motorCobro: `${(PCT_MOTOR * 100).toFixed(1)}% + IVA`,
      xololoAdmin: `${(PCT_XOLOLO * 100).toFixed(0)}% + IVA`,
    },
  };
};
