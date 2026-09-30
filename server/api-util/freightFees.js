// XOLOLO Envíos v2 · Freight: mirror server-side de src/util/freightFees.js.
// Duplicado a propósito porque el server es CommonJS y el cliente ESM.
// Si cambias uno, cambia el otro.
//
// Decisión de negocio (2026-09-30 con earias): freight NO lleva
// comisión propia de Xololo — sólo Motor de Cobro (Stripe) + Serv.
// Administrativos fijo. Ver comentario extendido en el cliente.

const PCT_MOTOR = 0.036;
const FIXED_XOLOLO_SUBUNITS = 1400; // $14.00 MXN fijo
const PCT_IVA = 0.16;

const round = n => Math.round(n);

// Mirror server-side de computeRetenciones/computeFreightBreakdown.
// TODO Facturama: pasar sellerTaxProfile leído de user.metadata cuando
// se conecte la integración.
const computeRetenciones = (fleteSubunits, sellerTaxProfile = null) => {
  return { retIsrSubunits: 0, retIvaSubunits: 0, retIsrPct: 0, retIvaPct: 0 };
};

const computeFreightBreakdown = (fleteSubunits, sellerTaxProfile = null) => {
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
    fleteSubunits: flete,
    motorCobroSubunits: motorCobro,
    ivaMotorSubunits: ivaMotor,
    xololoAdminSubunits: xololoAdmin,
    ivaXololoAdminSubunits: ivaXololoAdmin,
    retIsrSubunits,
    retIvaSubunits,
    retIsrPct,
    retIvaPct,
    totalFeesSubunits: totalFees,
    totalRetencionesSubunits: totalRetenciones,
    sellerReceivesSubunits: sellerReceives,
    totalSubunits: flete,
    labels: {
      motorCobro: `${(PCT_MOTOR * 100).toFixed(1)}% + IVA`,
      xololoAdmin: `$${(FIXED_XOLOLO_SUBUNITS / 100).toFixed(2)} + IVA`,
      retIsr: retIsrPct > 0 ? `${(retIsrPct * 100).toFixed(1)}%` : null,
      retIva: retIvaPct > 0 ? `${(retIvaPct * 100).toFixed(0)}% del IVA` : null,
    },
  };
};

module.exports = { computeFreightBreakdown };
