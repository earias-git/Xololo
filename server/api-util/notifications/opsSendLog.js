// XOLOLO 2026-11-18 — log en memoria de envíos ops.
//
// Ring buffer de 100 entradas. Se resetea con cada reboot del
// server (Render re-deploy, crash, etc.). Suficiente para
// trazabilidad inmediata; si se necesita persistencia duradera,
// migrar a Sharetribe marketplace metadata o DB externa.
//
// Cada entry tiene {id, at, to, subject, operator, status, resendId?, error?}.

const MAX_ENTRIES = 100;
const LOG = []; // más reciente primero

/**
 * Agrega una entrada al log.
 */
const push = ({ to, subject, operator, status, resendId, error }) => {
  const entry = {
    id: `log_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    at: new Date().toISOString(),
    to,
    subject,
    operator: operator?.email || operator || 'unknown',
    status, // 'sent' | 'failed'
    resendId: resendId || null,
    error: error || null,
  };
  LOG.unshift(entry);
  if (LOG.length > MAX_ENTRIES) LOG.length = MAX_ENTRIES;
  return entry;
};

/**
 * Lista el log (últimos N; por default todo el buffer).
 */
const list = ({ limit = MAX_ENTRIES } = {}) => LOG.slice(0, limit);

module.exports = { push, list, MAX_ENTRIES };
