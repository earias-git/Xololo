import { useEffect, useState } from 'react';

import { apiBaseUrl } from '../util/api';

// XOLOLO: checklist de onboarding del seller — misma fuente de verdad
// para dos consumidores:
//   - AccountProgressClock (informativo, muestra el avance en "Mi
//     cuenta", nunca bloquea)
//   - RequireSellerOnboarding (SÍ bloquea: redirige a un seller nuevo
//     que intenta publicar/gestionar listings sin haber terminado)
//
// 4 pasos se derivan de `currentUser` sin fetches. 2 pasos
// (suscripción, documentos legales) viven en metadata — sólo visible
// vía Integration API server-side — así que se resuelven con fetches
// livianos a /api/seller-subscription y /api/seller-legal-docs.

export const STEPS = [
  {
    key: 'profile',
    label: 'Datos personales',
    check: user => {
      const p = user?.attributes?.profile || {};
      return !!(p.firstName && p.lastName && p.displayName);
    },
    routeName: 'ProfileSettingsPage',
  },
  {
    key: 'contact',
    label: 'Contacto verificado',
    check: user => {
      const a = user?.attributes || {};
      return !!a.email && a.emailVerified === true;
    },
    routeName: 'ContactDetailsPage',
  },
  {
    key: 'payouts',
    label: 'Cobros configurados',
    check: user => user?.attributes?.stripeConnected === true,
    routeName: 'StripePayoutPage',
  },
  {
    key: 'store',
    label: 'Mi tienda',
    check: user => !!user?.attributes?.profile?.publicData?.slug,
    routeName: 'ManageStorePage',
  },
];

export const SUBSCRIPTION_STEP = {
  key: 'subscription',
  label: 'Suscripción activa',
  routeName: 'SubscriptionPage',
};

export const LEGAL_DOCS_STEP = {
  key: 'legalDocs',
  label: 'Documentos legales',
  routeName: 'LegalDocsPage',
};

export const isLegalDocsStepDone = legalDocsStatus => {
  if (!legalDocsStatus?.personType || !legalDocsStatus.requiredSlots?.length) return false;
  const docs = legalDocsStatus.docs || {};
  return legalDocsStatus.requiredSlots.every(slot => !!docs[slot.key]);
};

const useLightFetch = (path, enabled) => {
  const [state, setState] = useState({ data: null, settled: false });
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    fetch(`${apiBaseUrl()}${path}`, { credentials: 'include' })
      .then(res => (res.ok ? res.json() : null))
      .then(d => {
        if (!cancelled) setState({ data: d || null, settled: true });
      })
      .catch(() => {
        // XOLOLO: un fetch fallido igual "settlea" — el caller decide
        // si fallar abierto (dejar pasar) en vez de spinner infinito.
        if (!cancelled) setState(s => ({ ...s, settled: true }));
      });
    return () => {
      cancelled = true;
    };
  }, [path, enabled]);
  return state;
};

/**
 * @param {Object} currentUser
 * @param {boolean} enabled — false salta los 2 fetches livianos por completo
 *   (ej. RequireSellerOnboarding no los necesita para un seller que ya
 *   tiene listings publicadas — está "establecido" sin importar el
 *   checklist).
 * @returns {{ hasUser, loading, failed, results, doneCount, total, pct, allDone }}
 *   `failed`: al menos uno de los 2 fetches livianos terminó sin datos
 *   (error o respuesta vacía) — el caller decide si fallar abierto.
 */
export const useOnboardingStatus = (currentUser, enabled = true) => {
  const hasUser = !!currentUser?.id;
  const fetchesEnabled = hasUser && enabled;
  const legalDocs = useLightFetch('/api/seller-legal-docs', fetchesEnabled);
  const subscription = useLightFetch('/api/seller-subscription', fetchesEnabled);

  const empty = { hasUser, loading: false, failed: false, results: [], doneCount: 0, total: 0, pct: 0, allDone: false };
  if (!hasUser || !enabled) {
    return empty;
  }

  const loading = !legalDocs.settled || !subscription.settled;
  const failed = !loading && (legalDocs.data === null || subscription.data === null);

  const results = [
    ...STEPS.map(step => ({ ...step, done: step.check(currentUser) })),
    { ...SUBSCRIPTION_STEP, done: subscription.data?.status === 'active' },
    { ...LEGAL_DOCS_STEP, done: isLegalDocsStepDone(legalDocs.data) },
  ];
  const doneCount = results.filter(r => r.done).length;
  const total = results.length;
  const pct = Math.round((doneCount / total) * 100);
  const allDone = doneCount === total;

  return { hasUser: true, loading, failed, results, doneCount, total, pct, allDone };
};
