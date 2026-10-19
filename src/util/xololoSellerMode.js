// XOLOLO: modo de operación del seller y clasificación fiscal
// automática para ventas de segunda mano.
//
// Dos conceptos ortogonales:
//
//   1) sellerMode (perfil del usuario, publicData.sellerMode):
//        - 'store': seller con tienda, suscripción, catálogo recurrente.
//                   Puede vender nuevo y usado.
//        - 'casual_reseller': particular que vende sus bienes usados
//                   ocasionalmente. Sin tienda, sin suscripción, sin
//                   catálogo. Fiscalmente debe ser personType='individual'
//                   para que apliquen las exenciones de Art. 9 IV LIVA
//                   y no 113-A LISR.
//
//   2) condition (del listing, publicData.condition):
//        - 'new': artículo nuevo.
//        - 'used': artículo usado / segunda mano.
//
// La condición de "venta particular de bien usado" (exenta de IVA por
// Art. 9 IV LIVA y fuera de 113-A LISR) depende de la COMBINACIÓN de
// condition='used' + personType='individual'. El sellerMode casual es
// un atajo UX: fuerza esos defaults automáticamente, pero no es
// requisito legal; un seller 'store' particular que lista un usado
// también entra en Art. 9 IV.
//
// Reversamente: un casual que accidentalmente estuviera marcado como
// 'physical_business' NO entra en Art. 9 IV — habría actividad
// empresarial.

import { PERSON_TYPES } from './xololoPayout';
import {
  TAX_CLASSIFICATIONS,
  getClassificationByCode,
} from './xololoTaxClassification';

export const SELLER_MODES = {
  STORE: 'store',
  CASUAL_RESELLER: 'casual_reseller',
};

// XOLOLO: comisión variable por tramos de precio para el seller casual
// (segunda mano particular). Reemplaza la cuota fija de "serv.
// administrativos" ($14 + IVA) del modo tienda. Rationale: la venta
// casual típica es de bajo ticket y el valor absoluto de $14 pesaría
// demasiado en un listing de $300; en ticket alto el 9% quemaría al
// seller — por eso se degrada 9 → 6 → 3.
//
// Tramos (precio total con IVA incluido si aplica):
//   - Hasta $5,000  (<= 500000 subunits): 9%
//   - $5,001 - $100,000: 6%
//   - Más de $100,000 (> 10000000 subunits): 3%
//
// Al cargo porcentual se le suma IVA 16% (Xololo factura la comisión).
// Nota: con sellerMode=casual_reseller y personType=individual se
// aplica Art. 9 IV LIVA al bien vendido, pero la comisión DE XOLOLO
// sigue causando IVA porque Xololo sí es contribuyente del IVA.
export const CASUAL_COMMISSION_TIERS = [
  { upToSubunits: 500000, pct: 0.09, label: 'Hasta $5,000' },
  { upToSubunits: 10000000, pct: 0.06, label: '$5,001 - $100,000' },
  { upToSubunits: Infinity, pct: 0.03, label: 'Más de $100,000' },
];

/**
 * Devuelve la tasa de comisión aplicable al seller casual para el
 * precio dado (en subunits). Siempre encuentra tramo porque el último
 * es Infinity.
 */
export const resolveCasualCommissionPct = priceSubunits => {
  const p = Number(priceSubunits) || 0;
  const tier = CASUAL_COMMISSION_TIERS.find(t => p <= t.upToSubunits);
  return tier ? tier.pct : 0;
};

/**
 * Mismo cálculo pero devolviendo el tramo completo (porcentaje + label
 * humano) para mostrar en el preview "6% + IVA · $5,001 - $100,000".
 */
export const resolveCasualCommissionTier = priceSubunits => {
  const p = Number(priceSubunits) || 0;
  return CASUAL_COMMISSION_TIERS.find(t => p <= t.upToSubunits) || null;
};

export const LISTING_CONDITIONS = {
  NEW: 'new',
  USED: 'used',
};

export const LISTING_CONDITION_OPTIONS = [
  { key: LISTING_CONDITIONS.NEW, label: 'Nuevo' },
  { key: LISTING_CONDITIONS.USED, label: 'Usado / segunda mano' },
];

/**
 * Modo de venta del seller según su perfil. Si no lo declaró, default
 * conservador: 'store' (asumimos actividad empresarial, le retiene
 * algo). Al cambiar a 'casual_reseller' Xololo oculta la tienda y
 * fuerza personType='individual'.
 */
export const getSellerMode = currentUser => {
  const stored = currentUser?.attributes?.profile?.publicData?.sellerMode;
  return stored === SELLER_MODES.CASUAL_RESELLER
    ? SELLER_MODES.CASUAL_RESELLER
    : SELLER_MODES.STORE;
};

export const isCasualReseller = currentUser =>
  getSellerMode(currentUser) === SELLER_MODES.CASUAL_RESELLER;

/**
 * Resuelve el override fiscal AUTOMÁTICO que corresponde cuando el
 * artículo es usado. Retorna null cuando no debe aplicarse override
 * automático (el seller sigue en los defaults de categoría o en la
 * clasificación especial que haya declarado manualmente).
 *
 * Regla única (apegada a lo legal, acordada con el usuario):
 *
 *   condition === 'used' AND personType === 'individual'
 *     → EXENTO_9_IV automático. NO requiere revisión humana porque la
 *       combinación es verificable: el seller firmó personType y la
 *       UI exige marcar condition=used. La exención se registra con
 *       auto=true para que /ops pueda auditar.
 *
 *   Cualquier otra combinación → null (sin override automático).
 *     - Particular que vende nuevo: comercial normal.
 *     - PF empresarial o PM que vende usado: comercial normal.
 *       (El Art. 9 IV excluye explícitamente la enajenación habitual
 *       y por quien realiza actividades empresariales.)
 *
 * El override manual (TaxClassificationField) sigue teniendo prioridad
 * sobre este cálculo cuando está `approved` en /ops.
 */
export const resolveUsedGoodsOverride = ({ condition, personType }) => {
  if (condition !== LISTING_CONDITIONS.USED) return null;
  if (personType !== PERSON_TYPES.INDIVIDUAL) return null;
  const entry = getClassificationByCode(TAX_CLASSIFICATIONS.EXENTO_9_IV);
  if (!entry) return null;
  return {
    ivaMode: entry.ivaMode,
    taxActivity: entry.taxActivity,
    ivaArticle: entry.ivaArticle,
    source: 'auto_used_particular',
    label: entry.label,
  };
};

/**
 * Mensaje educativo para el seller según la combinación condition
 * + personType. Útil para el preview cuando quiere comunicar POR QUÉ
 * su payout cambió (o no).
 */
export const getUsedGoodsNotice = ({ condition, personType }) => {
  if (condition !== LISTING_CONDITIONS.USED) return null;

  if (personType === PERSON_TYPES.INDIVIDUAL) {
    return {
      kind: 'exempt',
      text:
        'Venta particular de bien usado: por Art. 9 fracc. IV LIVA no causa IVA, ' +
        'y por no haber actividad empresarial no entra en LISR 113-A. ' +
        'Recibes el 100% del precio (menos la comisión de Xololo).',
    };
  }
  if (personType === PERSON_TYPES.PHYSICAL_BUSINESS) {
    return {
      kind: 'commercial',
      text:
        'Venta comercial de artículo usado: aunque sea segunda mano, Art. 9 IV ' +
        'excluye expresamente a quienes realizan actividad empresarial. Se cobra ' +
        'IVA 16% y Xololo retiene ISR 113-A.',
    };
  }
  if (personType === PERSON_TYPES.MORAL) {
    return {
      kind: 'commercial',
      text:
        'Persona moral enajenando bien usado: se cobra IVA 16%. ISR 113-A no ' +
        'aplica a PM; la empresa declara el ISR por su cuenta.',
    };
  }
  return null;
};
