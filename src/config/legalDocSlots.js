// XOLOLO Track B (docs/SUBSCRIPTIONS_V1.md §2): mirror cliente de
// server/api-util/legalDocSlots.js. UN SOLO LUGAR (server) es la
// fuente de verdad para validación — este archivo es sólo para
// renderizar la UI (labels, accept de <input type="file">). Si se
// agrega/quita un slot en el server, replicar aquí.

export const LEGAL_DOC_SLOTS = [
  {
    key: 'identificacionOficial',
    label: 'Identificación oficial (INE o pasaporte)',
    personType: 'both',
    accept: 'image/png,image/jpeg,application/pdf',
  },
  {
    key: 'comprobanteDomicilio',
    label: 'Comprobante de domicilio',
    hint: 'Recibo de luz, agua o teléfono — menor a 3 meses.',
    personType: 'both',
    accept: 'image/png,image/jpeg,application/pdf',
  },
  {
    key: 'constanciaFiscal',
    label: 'Constancia de Situación Fiscal (SAT)',
    personType: 'both',
    // XOLOLO: omitido para seller casual — el casual tiene hasRfc=false
    // por definición y por lo tanto no tiene constancia que entregar.
    casualOk: false,
    accept: 'image/png,image/jpeg,application/pdf',
  },
  {
    key: 'curp',
    label: 'CURP',
    personType: 'fisica',
    // XOLOLO: omitido para seller casual — el CURP ya aparece en la
    // identificación oficial (INE/pasaporte), pedirlo por separado es
    // fricción sin valor para una venta ocasional.
    casualOk: false,
    accept: 'image/png,image/jpeg,application/pdf',
  },
  {
    key: 'actaConstitutiva',
    label: 'Acta constitutiva',
    personType: 'moral',
    accept: 'application/pdf',
  },
  {
    key: 'poderNotarial',
    label: 'Poder notarial del representante legal',
    personType: 'moral',
    accept: 'application/pdf',
  },
  {
    key: 'ineRepresentante',
    label: 'Identificación oficial del representante legal',
    personType: 'moral',
    accept: 'image/png,image/jpeg,application/pdf',
  },
];

// Filtra los slots aplicables al seller. En modo 'casual_reseller'
// (segunda mano particular) se omiten los slots con casualOk===false.
export const slotsForPersonType = (personType, sellerMode = 'store') =>
  LEGAL_DOC_SLOTS.filter(s => {
    const matchesPerson = s.personType === 'both' || s.personType === personType;
    if (!matchesPerson) return false;
    if (sellerMode === 'casual_reseller' && s.casualOk === false) return false;
    return true;
  });

export const STATUS_LABELS = {
  pending: { text: 'En revisión', tone: 'pending' },
  approved: { text: 'Aprobado', tone: 'approved' },
  rejected: { text: 'Rechazado', tone: 'rejected' },
};
