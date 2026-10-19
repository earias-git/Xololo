import { PERSON_TYPES } from './xololoPayout';

// XOLOLO: perfil fiscal del seller.
//
// Se declara una sola vez en Account Settings y aplica a TODOS sus listings.
// A diferencia de xololoTaxClassification (que vive por listing y requiere
// revisión humana), este perfil es del propio seller y afecta cómo se calcula
// el ISR 113-A y la retención por falta de RFC.
//
// Shape persistido en currentUser.attributes.profile.protectedData.xololoTaxProfile:
//   {
//     personType: 'particular' | 'pf_empresarial' | 'persona_moral',
//     hasRfc: true | false,
//     declaredAt: '2026-10-18T...',
//   }
//
// Interpretación legal (apegada a lo estricto, acordada con el usuario).
// Los nombres técnicos (individual / physical_business / moral) vienen del
// motor de cálculo (xololoPayout); abajo se explican con el término humano
// mexicano con el que el seller los reconoce:
//
//   individual (particular)
//                     → vende bienes propios ocasionalmente.
//                       NO causa ISR 113-A ni se le retiene IVA 113-C
//                       (no es "empresario" en términos LISR). Riesgo:
//                       si se vuelve habitual, el SAT puede reclasificarlo.
//
//   physical_business (persona física con actividad empresarial)
//                     → RESICO o Régimen General. SÍ aplica tabla
//                       LISR 113-A: 1% enajenación/servicios, 2.1%
//                       transporte, 4% hospedaje. Sin RFC → 20% ISR
//                       + 16% IVA.
//
//   moral (persona moral)
//                     → SA/SAPI/SC/AC. NO entra al régimen 113-A (es
//                       régimen de personas físicas). La plataforma no
//                       retiene ISR; la PM lo paga por su cuenta.
//
// Default: null (todavía no declaró). El preview trata null como
// "physical_business + hasRfc=true" porque es el caso más común en Xololo
// y el más conservador para el seller (le retiene algo). Al salir de ese
// default, el seller firma la declaración jurada y Xololo registra timestamp.

// Reexportamos PERSON_TYPES del motor de cálculo (xololoPayout) para que
// toda la app use los mismos valores canónicos: 'individual' |
// 'physical_business' | 'moral'. Las etiquetas humanas viven en el array
// de opciones de abajo.
export { PERSON_TYPES };

export const PERSON_TYPE_OPTIONS = [
  {
    key: PERSON_TYPES.PHYSICAL_BUSINESS,
    label: 'Persona física con actividad empresarial (RESICO o Régimen General)',
    helper:
      'Vendes como negocio: tienes RFC o estás por obtenerlo. Xololo retiene el ISR mensual (1% enajenación, 2.1% transporte, 4% hospedaje) y el IVA cuando aplica.',
  },
  {
    key: PERSON_TYPES.INDIVIDUAL,
    label: 'Particular — vendo mis cosas usadas ocasionalmente',
    helper:
      'No eres empresario para efectos del SAT (Art. 9 IV LIVA). Xololo NO retiene ISR 113-A. Si vendes habitualmente el SAT puede reclasificarte y exigirte RFC y declaraciones.',
  },
  {
    key: PERSON_TYPES.MORAL,
    label: 'Persona moral (SA, SAPI, SC, AC)',
    helper:
      'Tu empresa paga el ISR por su cuenta. Xololo no retiene ISR 113-A, sólo factura con el RFC de la empresa.',
  },
];

/**
 * Shape por default cuando el seller aún no declaró. Se trata como
 * "physical_business con RFC" en los cálculos para proteger a Xololo.
 */
export const DEFAULT_TAX_PROFILE = {
  personType: PERSON_TYPES.PHYSICAL_BUSINESS,
  hasRfc: true,
  declaredAt: null,
};

/**
 * Lee el perfil fiscal de un currentUser (shape de SDK). Devuelve
 * DEFAULT_TAX_PROFILE si no está declarado.
 */
export const getTaxProfile = currentUser => {
  const stored = currentUser?.attributes?.profile?.protectedData?.xololoTaxProfile;
  if (!stored) return DEFAULT_TAX_PROFILE;
  return {
    personType: stored.personType || DEFAULT_TAX_PROFILE.personType,
    hasRfc: typeof stored.hasRfc === 'boolean' ? stored.hasRfc : DEFAULT_TAX_PROFILE.hasRfc,
    declaredAt: stored.declaredAt || null,
  };
};

/**
 * Construye el payload a persistir en profile.protectedData.xololoTaxProfile
 * desde los valores del TaxProfileForm.
 */
export const buildTaxProfilePayload = values => ({
  personType: values?.personType || DEFAULT_TAX_PROFILE.personType,
  hasRfc: !!values?.hasRfc,
  declaredAt: new Date().toISOString(),
});
