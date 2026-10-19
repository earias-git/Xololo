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
// casualOk (default true):
//   true  → el documento se pide incluso en modo casual_reseller.
//   false → se OMITE para el seller casual (segunda mano particular).
//     Rationale documentado en docs/SELLER_CASUAL.md:
//     - Constancia Fiscal: el casual tiene hasRfc=false por definición
//       (Art. 9 IV LIVA requiere no tener actividad empresarial).
//     - CURP: redundante — ya aparece en la identificación oficial.
//
// PENDIENTE (docs/SUBSCRIPTIONS_V1.md §5): confirmar con earias la
// modalidad de integración con Facturama — si Xololo timbra
// centralizado con su propio CSD, 'rfc'/'constanciaFiscal' aquí
// pueden bastar; si cada seller conecta su propio CSD, hace falta
// agregar un slot para certificados .cer/.key + password (NO se
// implementa hasta confirmar, para no pedir de más).

const LEGAL_DOC_SLOTS = [
  {
    key: 'identificacionOficialFrente',
    label: 'Identificación oficial (INE o pasaporte) — frente',
    personType: 'both',
    accept: ['image/png', 'image/jpeg', 'image/jpg', 'application/pdf'],
  },
  {
    key: 'identificacionOficialReverso',
    label: 'Identificación oficial (INE o pasaporte) — reverso',
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
    casualOk: false,
    accept: ['image/png', 'image/jpeg', 'image/jpg', 'application/pdf'],
  },
  {
    key: 'curp',
    label: 'CURP',
    personType: 'fisica',
    casualOk: false,
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
    key: 'ineRepresentanteFrente',
    label: 'Identificación oficial del representante legal — frente',
    personType: 'moral',
    accept: ['image/png', 'image/jpeg', 'image/jpg', 'application/pdf'],
  },
  {
    key: 'ineRepresentanteReverso',
    label: 'Identificación oficial del representante legal — reverso',
    personType: 'moral',
    accept: ['image/png', 'image/jpeg', 'image/jpg', 'application/pdf'],
  },
];

const PERSON_TYPES = new Set(['fisica', 'moral']);

const SELLER_MODE_CASUAL = 'casual_reseller';

// Filtra los slots aplicables al seller. `sellerMode` acepta 'store' (default)
// y 'casual_reseller'; en casual se omiten los slots con casualOk===false
// (Constancia Fiscal y CURP) porque el casual tiene hasRfc=false y el CURP
// ya viene en la identificación oficial.
const slotsForPersonType = (personType, sellerMode = 'store') =>
  LEGAL_DOC_SLOTS.filter(s => {
    const matchesPerson = s.personType === 'both' || s.personType === personType;
    if (!matchesPerson) return false;
    if (sellerMode === SELLER_MODE_CASUAL && s.casualOk === false) return false;
    return true;
  });

const findSlot = key => LEGAL_DOC_SLOTS.find(s => s.key === key) || null;

module.exports = { LEGAL_DOC_SLOTS, PERSON_TYPES, slotsForPersonType, findSlot };
