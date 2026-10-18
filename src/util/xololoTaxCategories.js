// XOLOLO: mapa de clasificación fiscal DEFAULT por categoría del listing.
//
// Cada categoría Xololo (categoryLevel1 en publicData) tiene un default
// conservador de IVA y actividad fiscal. El seller puede overridear vía el
// futuro flag `taxClassificationOverride` cuando su producto cae en una
// excepción (ej. autor vendiendo libros propios en Papelería → Exento Art.
// 9 III, aunque el default de Papelería sea 16% gravado).
//
// El default conservador = 16% + 'enajenacion' para TODAS las categorías,
// porque:
//   1. Es la clasificación más común en Xololo (artesanía ornamental,
//      ropa, muebles, cosméticos, tecnología, servicios profesionales).
//   2. Si el seller declara mal su producto como exento/0% y no lo es,
//      Xololo recibe la multa SAT. Default conservador protege.
//   3. Las excepciones (Art. 2-A / 9 / 15 LIVA) requieren flag explícito
//      del seller + validación por IA + revisión humana (gate #39).
//
// Las categorías Turismo y Servicios Pro mantienen 16%+enajenacion default,
// aunque técnicamente pueden incluir hospedaje (4%) o servicios médicos
// con título (exento). Esos casos son excepción con flag.
//
// Mantener este mapa alineado con src/config/categories.js — si se agrega
// una categoría nueva (ej. "agro") hay que registrar su default aquí.

import { IVA_MODES, TAX_ACTIVITIES } from './xololoPayout';

const DEFAULT_CLASSIFICATION = {
  ivaMode: IVA_MODES.GRAVADO,
  taxActivity: TAX_ACTIVITIES.ENAJENACION_SERVICIOS,
  ivaArticle: 'Art. 1 LIVA',
};

const CLASSIFICATION_BY_CATEGORY = {
  artesanias: DEFAULT_CLASSIFICATION,
  hogar: DEFAULT_CLASSIFICATION,
  moda: DEFAULT_CLASSIFICATION,
  belleza: DEFAULT_CLASSIFICATION,
  alimentos: DEFAULT_CLASSIFICATION,
  tecnologia: DEFAULT_CLASSIFICATION,
  mascotas: DEFAULT_CLASSIFICATION,
  papeleria: DEFAULT_CLASSIFICATION,
  turismo: DEFAULT_CLASSIFICATION,
  'servicios-pro': DEFAULT_CLASSIFICATION,
};

/**
 * Devuelve la clasificación fiscal default para una categoría Xololo.
 * Si la categoría no está mapeada (listing viejo, categoría no registrada,
 * o categoría ausente), cae al default conservador 16%+enajenacion.
 *
 * @param {string} categoryId - categoryLevel1 del listing (ej. 'artesanias').
 * @returns {{ivaMode: string, taxActivity: string, ivaArticle: string}}
 */
export const getTaxDefaultsForCategory = categoryId => {
  if (!categoryId) return DEFAULT_CLASSIFICATION;
  return CLASSIFICATION_BY_CATEGORY[categoryId] || DEFAULT_CLASSIFICATION;
};
