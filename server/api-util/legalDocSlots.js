// XOLOLO Track B (docs/SUBSCRIPTIONS_V1.md §2): definición central de
// los documentos legales que se piden a un seller. UN SOLO LUGAR para
// ajustar la lista — nada de la lógica de upload/review depende de
// slots específicos, todo itera sobre este array.
//
// Sync con src/config/legalDocSlots.js (client) — mismo shape, mismos
// keys. Si se agrega/quita un slot aquí, replicar allá.
//
// personType:
//   'both'   → se pide sin importar el tipo de persona.
//   'fisica' → sólo si el seller es Persona Física.
//   'moral'  → sólo si el seller es Persona Moral (empresa).
//
// PENDIENTE (docs/SUBSCRIPTIONS_V1.md §5): confirmar con earias la
// modalidad de integración con Facturama — si Xololo timbra
// centralizado con su propio CSD, 'rfc'/'constanciaFiscal' aquí
// pueden bastar; si cada seller conecta su propio CSD, hace falta
// agregar un slot para certificados .cer/.key + password (NO se
// implementa hasta confirmar, para no pedir de más).

const LEGAL_DOC_SLOTS = [
  {
    key: 'identificacionOficial',
    label: 'Identificación oficial (INE o pasaporte)',
    personType: 'both',
    accept: ['image/png', 'image/jpeg', 'image/jpg', 'application/pdf'],
  },
  {
    key: 'comprobanteDomicilio',
    label: 'Comprobante de domicilio (recibo de luz/agua/teléfono, menor a 3 meses)',
    personType: 'both',
    accept: ['image/png', 'image/jpeg', 'image/jpg', 'application/pdf'],
  },
  {
    key: 'constanciaFiscal',
    label: 'Constancia de Situación Fiscal (SAT)',
    personType: 'both',
    accept: ['image/png', 'image/jpeg', 'image/jpg', 'application/pdf'],
  },
  {
    key: 'curp',
    label: 'CURP',
    personType: 'fisica',
    accept: ['image/png', 'image/jpeg', 'image/jpg', 'application/pdf'],
  },
  {
    key: 'actaConstitutiva',
    label: 'Acta constitutiva',
    personType: 'moral',
    accept: ['application/pdf'],
  },
  {
    key: 'poderNotarial',
    label: 'Poder notarial del representante legal',
    personType: 'moral',
    accept: ['application/pdf'],
  },
  {
    key: 'ineRepresentante',
    label: 'Identificación oficial del representante legal',
    personType: 'moral',
    accept: ['image/png', 'image/jpeg', 'image/jpg', 'application/pdf'],
  },
];

const PERSON_TYPES = new Set(['fisica', 'moral']);

const slotsForPersonType = personType =>
  LEGAL_DOC_SLOTS.filter(s => s.personType === 'both' || s.personType === personType);

const findSlot = key => LEGAL_DOC_SLOTS.find(s => s.key === key) || null;

module.exports = { LEGAL_DOC_SLOTS, PERSON_TYPES, slotsForPersonType, findSlot };
