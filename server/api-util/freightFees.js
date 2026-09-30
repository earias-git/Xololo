// XOLOLO Envíos v2 · Freight: mirror server-side de src/util/freightFees.js.
// Duplicado a propósito porque el server es CommonJS y el cliente ESM.
// Si cambias uno, cambia el otro.

const PCT_MOTOR = 0.036;
const PCT_XOLOLO = 0.14;
const PCT_IVA = 0.16;

const round = n => Math.round(n);

const computeFreightBreakdown = fleteSubunits => {
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
    labels: {
      motorCobro: `${(PCT_MOTOR * 100).toFixed(1)}% + IVA`,
      xololoAdmin: `${(PCT_XOLOLO * 100).toFixed(0)}% + IVA`,
    },
  };
};

module.exports = { computeFreightBreakdown };
