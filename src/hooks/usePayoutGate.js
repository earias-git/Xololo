import { useEffect, useState } from 'react';

import { apiBaseUrl } from '../util/api';

// XOLOLO Track #27: hook para consumir /api/seller-payout-gate.
//
// Devuelve el estado del gate que decide si el seller puede recibir
// pagos: stripeConnected + legalDocs completos. Un seller con blockers
// sigue pudiendo vender; el dinero queda retenido en Xololo hasta que
// los cierre (de ahí la urgencia del banner en Inbox / TransactionPage).
//
// Diseño:
//   - 1 fetch liviano con credentials; cache local durante la sesión.
//   - fallback silencioso: si el fetch falla, canReceivePayout=null para
//     que el caller decida si pintar algo (nosotros preferimos NO pintar
//     el banner si no hay data confirmada — evitar falsos positivos).
//   - enabled=false salta el fetch entero (ej. visitante no logueado).

const DEFAULT_STATE = {
  loading: false,
  settled: false,
  canReceivePayout: null,
  blockers: [],
  stripeConnected: false,
  legalDocsComplete: false,
};

export const usePayoutGate = (enabled = true) => {
  const [state, setState] = useState({ ...DEFAULT_STATE, loading: enabled });

  useEffect(() => {
    if (!enabled) {
      setState(DEFAULT_STATE);
      return undefined;
    }
    let cancelled = false;
    setState(s => ({ ...s, loading: true, settled: false }));
    fetch(`${apiBaseUrl()}/api/seller-payout-gate`, { credentials: 'include' })
      .then(res => (res.ok ? res.json() : null))
      .then(data => {
        if (cancelled) return;
        if (!data) {
          setState({ ...DEFAULT_STATE, settled: true });
          return;
        }
        setState({
          loading: false,
          settled: true,
          canReceivePayout: !!data.canReceivePayout,
          blockers: Array.isArray(data.blockers) ? data.blockers : [],
          stripeConnected: !!data.stripeConnected,
          legalDocsComplete: !!data.legalDocsComplete,
        });
      })
      .catch(() => {
        if (!cancelled) setState({ ...DEFAULT_STATE, settled: true });
      });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return state;
};
