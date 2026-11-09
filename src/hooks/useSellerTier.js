import { useEffect, useState } from 'react';

import { apiBaseUrl } from '../util/api';

// XOLOLO — Hook ligero para leer el tier de suscripción del seller
// desde /api/seller-subscription.
//
// Lo usan features que se habilitan por tier (ej. variantes SKU solo
// para Enterprise). Fail-open: si el fetch falla, devuelve tier = null
// y `failed: true` — el caller decide si mostrar la feature o no.
//
// Sin caché inter-render: cada mount hace su propio fetch. El endpoint
// es barato y se consulta solo cuando una UI tier-gated monta.

/**
 * @typedef {'starter' | 'enterprise' | null} SellerTier
 */

/**
 * @param {boolean} enabled — false salta el fetch (ej. usuario anónimo).
 * @returns {{ tier: SellerTier, loading: boolean, failed: boolean }}
 */
export const useSellerTier = (enabled = true) => {
  const [state, setState] = useState({ tier: null, loading: enabled, failed: false });

  useEffect(() => {
    if (!enabled) {
      setState({ tier: null, loading: false, failed: false });
      return;
    }
    let cancelled = false;
    setState(s => ({ ...s, loading: true }));
    fetch(`${apiBaseUrl()}/api/seller-subscription`, { credentials: 'include' })
      .then(res => (res.ok ? res.json() : null))
      .then(data => {
        if (cancelled) return;
        if (data && typeof data.tier === 'string') {
          setState({ tier: data.tier, loading: false, failed: false });
        } else {
          setState({ tier: null, loading: false, failed: true });
        }
      })
      .catch(() => {
        if (!cancelled) setState({ tier: null, loading: false, failed: true });
      });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return state;
};

/**
 * Tiers que habilitan SKU/variantes en el wizard.
 * Starter NO tiene variantes (un listing = una pieza).
 */
export const TIERS_WITH_VARIANTS = ['enterprise'];

/**
 * @param {SellerTier} tier
 * @returns {boolean}
 */
export const tierHasVariants = tier => TIERS_WITH_VARIANTS.includes(tier);
