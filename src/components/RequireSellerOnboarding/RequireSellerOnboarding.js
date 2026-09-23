import React, { useEffect, useState } from 'react';
import { useSelector } from 'react-redux';

import { apiBaseUrl } from '../../util/api';
import { useOnboardingStatus } from '../../hooks/useOnboardingStatus';
import NamedRedirect from '../NamedRedirect/NamedRedirect';
import IconSpinner from '../IconSpinner/IconSpinner';

import css from './RequireSellerOnboarding.module.css';

// XOLOLO Track A (docs/SUBSCRIPTIONS_V1.md §1.2): "detección de
// onboarding incompleto". Envuelve las rutas donde un user intenta
// actuar como seller por primera vez — publicar (`EditListingPage`
// con type 'new') o gestionar sus productos (`ManageListingsPage`) —
// y lo manda a terminar el checklist de "Mi cuenta" si le falta algo.
//
// Deliberadamente NO se aplica a: editar una listing YA existente, ni
// a ningún otro lado de la app. Un seller "establecido" (ya tiene al
// menos una listing publicada) NUNCA se redirige aunque le falte un
// paso nuevo del checklist (ej. Suscripción, agregada después de que
// él ya vendía) — eso lo cubre el aviso informativo de
// AccountProgressClock, no un bloqueo.
//
// "¿Tiene listings publicadas?" se resuelve vía /api/seller-has-listings
// (Integration API server-side) — NO vía el flag currentUserHasListings
// de Redux (sdk.ownListings.query() client-side), que resultó no
// confiable en este ambiente (nunca se dispara por el debounce de
// fetchCurrentUser tras SSR, o falla con 401 según el token del SDK
// en el browser). Mismo patrón ya usado para suscripción/docs legales.
//
// Falla ABIERTO (deja pasar, nunca bloquea) ante cualquier duda: si
// /api/seller-has-listings falla, o los 2 fetches del checklist
// fallan, se deja pasar en vez de bloquear indefinidamente. Bloquear
// de más a un seller real por un hiccup de infraestructura es peor
// que ocasionalmente no gatear a alguien genuinamente nuevo.
const useHasPublishedListings = hasUser => {
  const [state, setState] = useState({ checked: false, hasListings: false, failed: false });
  useEffect(() => {
    if (!hasUser) return;
    let cancelled = false;
    fetch(`${apiBaseUrl()}/api/seller-has-listings`, { credentials: 'include' })
      .then(res => (res.ok ? res.json() : Promise.reject(new Error('bad_status'))))
      .then(d => {
        if (!cancelled) setState({ checked: true, hasListings: !!d?.hasPublishedListings, failed: false });
      })
      .catch(() => {
        if (!cancelled) setState({ checked: true, hasListings: false, failed: true });
      });
    return () => {
      cancelled = true;
    };
  }, [hasUser]);
  return state;
};

const RequireSellerOnboarding = ({ children }) => {
  const currentUser = useSelector(state => state.user?.currentUser || null);
  const hasUser = !!currentUser?.id;

  const { checked, hasListings, failed: hasListingsFailed } = useHasPublishedListings(hasUser);
  const stillCheckingListings = hasUser && !checked;

  const { loading, failed: checklistFailed, allDone } = useOnboardingStatus(
    currentUser,
    hasUser && checked && !hasListingsFailed && !hasListings
  );

  const failOpen = !hasUser || hasListings || hasListingsFailed || checklistFailed;
  if (failOpen) {
    return children;
  }

  if (stillCheckingListings || loading) {
    return (
      <div className={css.loading}>
        <IconSpinner />
      </div>
    );
  }

  if (!allDone) {
    return <NamedRedirect name="ProfileSettingsPage" />;
  }

  return children;
};

export default RequireSellerOnboarding;
