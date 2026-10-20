// XOLOLO: catálogo de clasificaciones fiscales especiales por listing.
//
// Se usa cuando el seller marca "Mi producto tiene clasificación fiscal
// especial" en el form de Pricing. Reemplaza al default de la categoría
// (xololoTaxCategories) con el régimen explícito del Art. 2-A / 9 / 15
// LIVA o la actividad distinta a enajenación/servicios en LISR 113-A.
//
// Fuente de verdad: tabla validada con CP Ernesto en el Google Sheet
// "Xololo — Ejemplos de IVA" (filas 13-29 cubren todos los casos aquí).
//
// Shape persistido en listing.attributes.publicData.taxClassification:
//   {
//     code: 'exento_9_iv',          // uno de los códigos de abajo
//     declaredAt: '2026-10-18T...', // timestamp firma del seller
//     declaredIp: '189.x.x.x',      // IP del momento (log antifraude)
//     reviewStatus: 'pending' |     // gate antifraude task #39:
//                   'approved' |    //   IA + revisión humana /ops antes
//                   'rejected',     //   de aplicar el override en producción
//     reviewedBy: 'operator@xololo.mx',  // null hasta revisión
//     reviewedAt: null,
//   }
//
// Mientras reviewStatus !== 'approved', el preview debe mostrar el override
// como "pendiente de aprobación" y los cálculos reales usar el default
// conservador 16% + enajenación. Esto se maneja en el componente, no aquí.

import { IVA_MODES, TAX_ACTIVITIES } from './xololoPayout';

export const TAX_CLASSIFICATIONS = {
  // Exenciones LIVA Art. 9 (bienes)
  EXENTO_9_IV: 'exento_9_iv',
  EXENTO_9_III: 'exento_9_iii',

  // Tasa 0% LIVA Art. 2-A (bienes gravados a tasa cero)
  TASA_CERO_2A_I_A: 'tasa_cero_2a_i_a',
  TASA_CERO_2A_I_B: 'tasa_cero_2a_i_b',
  TASA_CERO_2A_I_D: 'tasa_cero_2a_i_d',
  TASA_CERO_2A_I_F: 'tasa_cero_2a_i_f',
  TASA_CERO_2A_I_I: 'tasa_cero_2a_i_i',
  TASA_CERO_2A_I_J: 'tasa_cero_2a_i_j',

  // Exenciones LIVA Art. 15 (servicios)
  EXENTO_15_IV: 'exento_15_iv',
  EXENTO_15_XIV: 'exento_15_xiv',
  EXENTO_15_XVI: 'exento_15_xvi',

  // Actividades fiscales LISR 113-A distintas a "enajenación/servicios"
  ACTIVIDAD_TRANSPORTE: 'actividad_transporte',
  ACTIVIDAD_HOSPEDAJE: 'actividad_hospedaje',
};

const CATALOG = {
  [TAX_CLASSIFICATIONS.EXENTO_9_IV]: {
    label: 'Bienes muebles usados por particular (Art. 9 IV)',
    ivaMode: IVA_MODES.EXENTO,
    taxActivity: TAX_ACTIVITIES.ENAJENACION_SERVICIOS,
    ivaArticle: 'Art. 9 fracc. IV LIVA',
    description:
      'Vendedor particular que vende sus propios bienes usados de forma ocasional. Pierde la exención si es empresa o si lo hace de forma habitual.',
    requiresReview: true,
    // XOLOLO: esta clasificación es incompatible con producto nuevo.
    // El dropdown de TaxClassificationField la oculta cuando condition='new'
    // y la auto-aplica cuando condition='used' + personType='individual'
    // (ver resolveUsedGoodsOverride en xololoSellerMode).
    requiresUsed: true,
  },
  [TAX_CLASSIFICATIONS.EXENTO_9_III]: {
    label: 'Libro/revista/obra del propio autor (Art. 9 III)',
    ivaMode: IVA_MODES.EXENTO,
    taxActivity: TAX_ACTIVITIES.ENAJENACION_SERVICIOS,
    ivaArticle: 'Art. 9 fracc. III LIVA',
    description:
      'El autor vende directamente su obra. No puedes acreditar IVA de insumos. Si eres editor registrado, considera Art. 2-A I-i (tasa 0%) que sí permite acreditación.',
    requiresReview: true,
  },
  [TAX_CLASSIFICATIONS.TASA_CERO_2A_I_A]: {
    label: 'Animales y vegetales no industrializados (Art. 2-A I-a)',
    ivaMode: IVA_MODES.TASA_CERO,
    taxActivity: TAX_ACTIVITIES.ENAJENACION_SERVICIOS,
    ivaArticle: 'Art. 2-A I-a LIVA',
    description:
      'Frutas, verduras, flores naturales, semillas. Excluye perros/gatos/mascotas pequeñas y hule.',
    requiresReview: true,
  },
  [TAX_CLASSIFICATIONS.TASA_CERO_2A_I_B]: {
    label: 'Alimentos NO procesados (Art. 2-A I-b)',
    ivaMode: IVA_MODES.TASA_CERO,
    taxActivity: TAX_ACTIVITIES.ENAJENACION_SERVICIOS,
    ivaArticle: 'Art. 2-A I-b LIVA',
    description:
      'Medicinas de patente y productos para alimentación humana. Alimentos preparados para consumo o entrega a domicilio NO entran — pagan 16%.',
    requiresReview: true,
  },
  [TAX_CLASSIFICATIONS.TASA_CERO_2A_I_D]: {
    label: 'Ixtle, palma y lechuguilla (Art. 2-A I-d)',
    ivaMode: IVA_MODES.TASA_CERO,
    taxActivity: TAX_ACTIVITIES.ENAJENACION_SERVICIOS,
    ivaArticle: 'Art. 2-A I-d LIVA',
    description: 'Fibras naturales usadas en artesanía tradicional.',
    requiresReview: true,
  },
  [TAX_CLASSIFICATIONS.TASA_CERO_2A_I_F]: {
    label: 'Fertilizantes y plaguicidas agrícolas (Art. 2-A I-f)',
    ivaMode: IVA_MODES.TASA_CERO,
    taxActivity: TAX_ACTIVITIES.ENAJENACION_SERVICIOS,
    ivaArticle: 'Art. 2-A I-f LIVA',
    description: 'Fertilizantes, plaguicidas, herbicidas y fungicidas destinados a agricultura o ganadería.',
    requiresReview: true,
  },
  [TAX_CLASSIFICATIONS.TASA_CERO_2A_I_I]: {
    label: 'Libros editados por el propio contribuyente (Art. 2-A I-i)',
    ivaMode: IVA_MODES.TASA_CERO,
    taxActivity: TAX_ACTIVITIES.ENAJENACION_SERVICIOS,
    ivaArticle: 'Art. 2-A I-i LIVA',
    description:
      'TÚ eres el editor registrado del libro. Diferente a Art. 9 III (donde eres el autor). Esta sí permite acreditar IVA de insumos.',
    requiresReview: true,
  },
  [TAX_CLASSIFICATIONS.TASA_CERO_2A_I_J]: {
    label: 'Toallas sanitarias, tampones y copas (Art. 2-A I-j)',
    ivaMode: IVA_MODES.TASA_CERO,
    taxActivity: TAX_ACTIVITIES.ENAJENACION_SERVICIOS,
    ivaArticle: 'Art. 2-A I-j LIVA',
    description: 'Productos de higiene menstrual. Agregado por reforma 12-11-2021.',
    requiresReview: true,
  },
  [TAX_CLASSIFICATIONS.EXENTO_15_IV]: {
    label: 'Enseñanza con RVOE o preescolar (Art. 15 IV)',
    ivaMode: IVA_MODES.EXENTO,
    taxActivity: TAX_ACTIVITIES.ENAJENACION_SERVICIOS,
    ivaArticle: 'Art. 15 fracc. IV LIVA',
    description:
      'Servicios educativos con reconocimiento SEP (RVOE) o nivel preescolar. Clases sin RVOE pagan 16%.',
    requiresReview: true,
  },
  [TAX_CLASSIFICATIONS.EXENTO_15_XIV]: {
    label: 'Servicios médicos con título (Art. 15 XIV)',
    ivaMode: IVA_MODES.EXENTO,
    taxActivity: TAX_ACTIVITIES.ENAJENACION_SERVICIOS,
    ivaArticle: 'Art. 15 fracc. XIV LIVA',
    description:
      'Servicios profesionales de medicina prestados por médico con cédula. Masajes, acupuntura por no-médico pagan 16%.',
    requiresReview: true,
  },
  [TAX_CLASSIFICATIONS.EXENTO_15_XVI]: {
    label: 'Regalías del autor por obra inscrita (Art. 15 XVI)',
    ivaMode: IVA_MODES.EXENTO,
    taxActivity: TAX_ACTIVITIES.ENAJENACION_SERVICIOS,
    ivaArticle: 'Art. 15 fracc. XVI LIVA',
    description:
      'Autor licencia su obra escrita, musical o artística inscrita en Registro Público del Derecho de Autor. No aplica a logos, diseños industriales o publicidad.',
    requiresReview: true,
  },
  [TAX_CLASSIFICATIONS.ACTIVIDAD_TRANSPORTE]: {
    label: 'Transporte terrestre o entrega de bienes (LISR 113-A, ISR 2.1%)',
    ivaMode: IVA_MODES.GRAVADO,
    taxActivity: TAX_ACTIVITIES.TRANSPORTE_ENTREGA,
    ivaArticle: 'Art. 1 LIVA',
    description:
      'Rappi, Uber Eats, mandados, entregas locales. La plataforma retiene 2.1% ISR en lugar del 1% default.',
    requiresReview: true,
  },
  [TAX_CLASSIFICATIONS.ACTIVIDAD_HOSPEDAJE]: {
    label: 'Hospedaje (LISR 113-A, ISR 4%)',
    ivaMode: IVA_MODES.GRAVADO,
    taxActivity: TAX_ACTIVITIES.HOSPEDAJE,
    ivaArticle: 'Art. 1 LIVA',
    description:
      'Airbnb, Booking, hoteles, cabañas. La plataforma retiene 4% ISR en lugar del 1% default. Hoteles NO son exentos (Art. 9 II los excluye).',
    requiresReview: true,
  },
};

/**
 * Lista ordenada para render en dropdowns del form.
 * Separada por grupo para que la UI pueda agrupar visualmente.
 */
export const CLASSIFICATION_GROUPS = [
  {
    label: 'Exentos de IVA — Bienes (Art. 9 LIVA)',
    items: [TAX_CLASSIFICATIONS.EXENTO_9_IV, TAX_CLASSIFICATIONS.EXENTO_9_III],
  },
  {
    label: 'Tasa 0% IVA — Bienes (Art. 2-A LIVA)',
    items: [
      TAX_CLASSIFICATIONS.TASA_CERO_2A_I_A,
      TAX_CLASSIFICATIONS.TASA_CERO_2A_I_B,
      TAX_CLASSIFICATIONS.TASA_CERO_2A_I_D,
      TAX_CLASSIFICATIONS.TASA_CERO_2A_I_F,
      TAX_CLASSIFICATIONS.TASA_CERO_2A_I_I,
      TAX_CLASSIFICATIONS.TASA_CERO_2A_I_J,
    ],
  },
  {
    label: 'Exentos de IVA — Servicios (Art. 15 LIVA)',
    items: [
      TAX_CLASSIFICATIONS.EXENTO_15_IV,
      TAX_CLASSIFICATIONS.EXENTO_15_XIV,
      TAX_CLASSIFICATIONS.EXENTO_15_XVI,
    ],
  },
  {
    label: 'Actividad fiscal distinta (LISR 113-A)',
    items: [TAX_CLASSIFICATIONS.ACTIVIDAD_TRANSPORTE, TAX_CLASSIFICATIONS.ACTIVIDAD_HOSPEDAJE],
  },
];

/**
 * Devuelve el objeto completo (label, ivaMode, taxActivity, ivaArticle,
 * description) para un código de clasificación. Null si el código no existe.
 */
export const getClassificationByCode = code => (code ? CATALOG[code] || null : null);

/**
 * Resuelve el override a aplicar en el preview a partir del valor persistido
 * en listing.attributes.publicData.taxClassification. Devuelve null si no
 * hay override o si está pendiente de revisión (gate antifraude #39).
 *
 * Mientras reviewStatus !== 'approved', el preview sigue mostrando el default
 * de la categoría y el seller ve un indicador de "en revisión".
 */
export const resolveTaxOverride = taxClassification => {
  if (!taxClassification?.code) return null;
  if (taxClassification.reviewStatus !== 'approved') return null;
  const entry = CATALOG[taxClassification.code];
  if (!entry) return null;
  return {
    ivaMode: entry.ivaMode,
    taxActivity: entry.taxActivity,
    ivaArticle: entry.ivaArticle,
  };
};
