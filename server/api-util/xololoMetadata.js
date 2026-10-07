// XOLOLO Fase 1 (hoja Arquitectura técnica §1) — Helpers de lectura y
// escritura de las nuevas estructuras de metadata del sistema de
// penalidades y disputas. UN SOLO LUGAR para que todos los endpoints
// lean/escriban con el mismo shape — evita que cada consumer invente
// su propia forma del objeto.
//
// Estructuras:
//
// 1) tx.attributes.metadata.xololoPenalties = Array<Penalty>
//    - Historial de penalidades aplicadas a UNA transacción.
//    - Cada Penalty: {
//        id: string (uuid),
//        level: 1 | 2 | 3,
//        amountSubunits: number (incluye IVA),
//        reason: string,
//        appliedBy: string (operatorId),
//        appliedAt: ISO date,
//        status: 'pending' | 'charged' | 'appealed' | 'reverted',
//        chargeIntentId: string | null (Stripe PI id),
//        cfdiId: string | null (Facturama folio),
//      }
//
// 2) user.attributes.profile.metadata.xololoDebt = {
//      totalSubunits: number,
//      items: Array<DebtItem>,  // {txId, penaltyId, amountSubunits, dueDate}
//      lastRetryAt: ISO date | null,
//      retriesCount: number (0-3, al llegar a 3 propone suspensión),
//      status: 'current' | 'pending' | 'overdue' | 'suspended',
//    }
//    - Solo aplica a sellers. Buyer puro no tiene este objeto.
//
// 3) user.attributes.profile.metadata.xololoDisputeHistory =
//    Array<HistoryItem> donde HistoryItem = {
//      date: ISO date,
//      txId: string,
//      faultType: 'no-quote' | 'no-dispatch' | 'no-prepare' | 'cancel-late'
//               | 'service-no-show' | 'dispute-lost' | ...,
//      levelApplied: 1 | 2 | 3,
//    }
//    - Rolling window de 30 días (REINCIDENCE_WINDOW_DAYS) para
//      calcular el próximo nivel propuesto.
//
// Convenciones:
//   - TODOS los montos en subunits (centavos MXN) para evitar errores
//     de float. Los displays convierten a MXN dividiendo entre 100.
//   - TODAS las fechas en ISO 8601 UTC string. No usar Date objects
//     porque Sharetribe metadata serializa a JSON.
//   - Los objetos SIEMPRE se mezclan con `{...existing, ...update}` —
//     nunca sobrescribir el objeto entero sin leer antes.

const crypto = require('crypto');
const { REINCIDENCE_WINDOW_DAYS } = require('./xololoFees');

// ============================================================
// Penalties (tx metadata)
// ============================================================

/**
 * Devuelve el array de penalidades de una transacción (o [] si no tiene).
 * Nunca lanza — si la estructura no existe o es inválida, devuelve [].
 */
const getPenalties = tx => {
  const arr = tx?.attributes?.metadata?.xololoPenalties;
  return Array.isArray(arr) ? arr : [];
};

/**
 * Construye un objeto Penalty para persistir. No lo guarda —
 * eso lo hace el caller con Integration SDK sobre la tx.
 */
const buildPenalty = ({
  level,
  amountSubunits,
  reason,
  appliedBy,
  status = 'pending',
}) => {
  if (![1, 2, 3].includes(level)) {
    throw new Error('penalty_level_invalid');
  }
  return {
    id: crypto.randomUUID(),
    level,
    amountSubunits: Number(amountSubunits) || 0,
    reason: String(reason || '').slice(0, 500),
    appliedBy: String(appliedBy || 'system'),
    appliedAt: new Date().toISOString(),
    status,
    chargeIntentId: null,
    cfdiId: null,
  };
};

/**
 * Actualiza una penalidad específica dentro del array por id.
 * Devuelve el array nuevo (no muta el original).
 */
const updatePenalty = (penalties, penaltyId, patch) => {
  return penalties.map(p =>
    p.id === penaltyId ? { ...p, ...patch } : p
  );
};

// ============================================================
// Debt (user metadata, seller)
// ============================================================

const EMPTY_DEBT = {
  totalSubunits: 0,
  items: [],
  lastRetryAt: null,
  retriesCount: 0,
  status: 'current',
};

/**
 * Devuelve el objeto Debt del seller (o EMPTY_DEBT si no existe).
 */
const getDebt = user => {
  const d = user?.attributes?.profile?.metadata?.xololoDebt;
  if (!d || typeof d !== 'object') return { ...EMPTY_DEBT };
  return {
    totalSubunits: Number(d.totalSubunits) || 0,
    items: Array.isArray(d.items) ? d.items : [],
    lastRetryAt: d.lastRetryAt || null,
    retriesCount: Number(d.retriesCount) || 0,
    status: d.status || 'current',
  };
};

/**
 * Agrega un item de deuda y recalcula totalSubunits + status.
 * Pasa de 'current' a 'pending' en cuanto hay cualquier deuda > 0.
 */
const addDebtItem = (debt, { txId, penaltyId, amountSubunits, dueDate }) => {
  const items = [
    ...debt.items,
    {
      txId: String(txId),
      penaltyId: String(penaltyId),
      amountSubunits: Number(amountSubunits) || 0,
      dueDate: dueDate || null,
      addedAt: new Date().toISOString(),
    },
  ];
  const totalSubunits = items.reduce((s, i) => s + i.amountSubunits, 0);
  return {
    ...debt,
    items,
    totalSubunits,
    status: totalSubunits > 0 && debt.status === 'current' ? 'pending' : debt.status,
  };
};

/**
 * Marca una deuda como pagada (removiendo el item). Si no quedan
 * items, el status vuelve a 'current' y se resetea retriesCount.
 */
const settleDebtItem = (debt, penaltyId) => {
  const items = debt.items.filter(i => i.penaltyId !== penaltyId);
  const totalSubunits = items.reduce((s, i) => s + i.amountSubunits, 0);
  return {
    ...debt,
    items,
    totalSubunits,
    status: totalSubunits === 0 ? 'current' : debt.status,
    retriesCount: totalSubunits === 0 ? 0 : debt.retriesCount,
    lastRetryAt: totalSubunits === 0 ? null : debt.lastRetryAt,
  };
};

/**
 * Registra un intento fallido de cobro. Incrementa retriesCount y
 * marca lastRetryAt. Al llegar a 3 reintentos, status pasa a
 * 'overdue' (el scheduler propondrá suspensión al operator).
 */
const recordFailedRetry = debt => {
  const retriesCount = debt.retriesCount + 1;
  return {
    ...debt,
    retriesCount,
    lastRetryAt: new Date().toISOString(),
    status: retriesCount >= 3 ? 'overdue' : 'pending',
  };
};

// ============================================================
// Dispute history (user metadata, para calcular reincidencia)
// ============================================================

/**
 * Devuelve el historial de disputas del user (o [] si no tiene).
 */
const getDisputeHistory = user => {
  const arr = user?.attributes?.profile?.metadata?.xololoDisputeHistory;
  return Array.isArray(arr) ? arr : [];
};

/**
 * Agrega un item al historial y devuelve el array nuevo. No limpia
 * items viejos — eso se hace al leer con `countRecentFaults` que ya
 * filtra por ventana de 30 días.
 */
const addDisputeHistoryItem = (history, { txId, faultType, levelApplied }) => {
  return [
    ...history,
    {
      date: new Date().toISOString(),
      txId: String(txId),
      faultType: String(faultType),
      levelApplied: Number(levelApplied) || 0,
    },
  ];
};

/**
 * Cuenta cuántas faltas tiene el user en los últimos
 * REINCIDENCE_WINDOW_DAYS (30 por default). Base para que el sistema
 * proponga N1 vs N2 vs N3 al operator.
 */
const countRecentFaults = history => {
  const cutoff = Date.now() - REINCIDENCE_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  return history.filter(h => {
    const d = Date.parse(h.date);
    return Number.isFinite(d) && d >= cutoff;
  }).length;
};

/**
 * Propone el nivel de penalidad para una nueva falta basándose en
 * cuántas faltas tiene el user en la ventana rolling.
 * Reglas: 0 faltas previas → N1 · 1 falta → N2 · 2+ faltas → N3.
 * El operator PUEDE cambiarlo manualmente — esto es solo guía.
 */
const proposeNextLevel = history => {
  const count = countRecentFaults(history);
  if (count === 0) return 1;
  if (count === 1) return 2;
  return 3;
};

module.exports = {
  // Penalties
  getPenalties,
  buildPenalty,
  updatePenalty,

  // Debt
  getDebt,
  addDebtItem,
  settleDebtItem,
  recordFailedRetry,
  EMPTY_DEBT,

  // Dispute history
  getDisputeHistory,
  addDisputeHistoryItem,
  countRecentFaults,
  proposeNextLevel,
};
