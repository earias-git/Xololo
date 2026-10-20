import { useEffect, useState } from 'react';

import { apiBaseUrl } from '../util/api';

// XOLOLO Track #27 Fase 2: hook para consumir /api/seller-pending-payouts.
// Da el monto retenido en Xololo + conteo de tx. El PayoutGateBanner
// lo usa para pintar "$450 esperando" como motivación concreta.
//
// Falla cerrado: si el fetch falla, pendingAmountSubunits=null para que
// el caller decida si mostrar algo o esconderse.

const DEFAULT_STATE = {
  loading: false,
  settled: false,
  pendingCount: 0,
  pendingAmountSubunits: null,
  currency: 'MXN',
  oldestPendingAt: null,
};

export const usePendingPayouts = (enabled = true) => {
  const [state, setState] = useState({ ...DEFAULT_STATE, loading: enabled });

  useEffect(() => {
    if (!enabled) {
      setState(DEFAULT_STATE);
      return undefined;
    }
    let cancelled = false;
    setState(s => ({ ...s, loading: true, settled: false }));
    fetch(`${apiBaseUrl()}/api/seller-pending-payouts`, { credentials: 'include' })
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
          pendingCount: data.pendingCount || 0,
          pendingAmountSubunits: data.pendingAmountSubunits ?? 0,
          currency: data.currency || 'MXN',
          oldestPendingAt: data.oldestPendingAt || null,
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
