// XOLOLO Envíos v2 · Freight: mirror server-side de src/util/freightFees.js.
// Duplicado a propósito porque el server es CommonJS y el cliente ESM.
// Si cambias uno, cambia el otro.

const PCT_MOTOR = 0.036;
const FIXED_XOLOLO_SUBUNITS = 1400; // $14.00 MXN fijo
const PCT_IVA = 0.16;

const round = n => Math.round(n);

const computeFreightBreakdown = fleteSubunits => {
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
    totalSubunits: flete, // Alias legacy; el buyer paga flete exacto.
    labels: {
      motorCobro: `${(PCT_MOTOR * 100).toFixed(1)}% + IVA`,
      xololoAdmin: `$${(FIXED_XOLOLO_SUBUNITS / 100).toFixed(2)} + IVA`,
    },
  };
};

module.exports = { computeFreightBreakdown };
