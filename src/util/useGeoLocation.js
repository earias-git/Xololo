// XOLOLO: hook para leer el geo-IP hint del buyer. Se usa en
// ListingPage/CartPage/etc. para advertir cuando el estado detectado
// no está en coverageStates de un listing con localDelivery.
//
// Cache: por sesión (sessionStorage). Una sola llamada al server por
// tab, aunque el hook se use en múltiples componentes. Si el buyer
// abre otro tab, se re-consulta — aceptable dado que el cache TTL
// server-side ya evita hits repetidos a ipapi.

import { useEffect, useState } from 'react';

import { apiBaseUrl } from './api';

const SESSION_KEY = 'xolo:geo-ip:v1';

const readSession = () => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
};

const writeSession = value => {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(value));
  } catch (e) {
    /* quota o incognito con storage bloqueado — ignorable */
  }
};

// Fetch compartido para múltiples consumidores dentro del mismo render tree.
let inflight = null;

const fetchGeo = async () => {
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const res = await fetch(`${apiBaseUrl()}/api/geo-ip`, {
        credentials: 'include',
      });
      const data = await res.json().catch(() => ({}));
      return {
        country: data.country || null,
        state: data.state || null,
        city: data.city || null,
      };
    } catch (e) {
      return { country: null, state: null, city: null };
    } finally {
      inflight = null;
    }
  })();
  return inflight;
};

/**
 * useGeoLocation() → { data, loading }
 *   data.country / data.state / data.city (todos pueden ser null)
 *
 * Consumo típico:
 *   const { data: geo } = useGeoLocation();
 *   const covered = geo?.state && coverageStates.includes(geo.state);
 */
export const useGeoLocation = () => {
  const [state, setState] = useState(() => {
    const cached = readSession();
    return {
      data: cached,
      loading: !cached,
    };
  });

  useEffect(() => {
    if (state.data) return;
    let cancelled = false;
    fetchGeo().then(data => {
      if (cancelled) return;
      writeSession(data);
      setState({ data, loading: false });
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return state;
};
