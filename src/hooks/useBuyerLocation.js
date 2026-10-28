import { useCallback, useEffect, useState } from 'react';

import { apiBaseUrl } from '../util/api';

// XOLOLO Task #17: hook que persiste la ubicación del buyer en localStorage.
//
// Shape persistido en localStorage.xololoBuyerLocation:
//   {
//     cp: '62000',
//     state: 'Morelos',
//     city: 'Cuernavaca',
//     setAt: '2026-10-26T18:00:00Z',
//     source: 'manual' | 'geolocation',
//   }
//
// Consumidores:
//   - LandingPage: banda "Cerca de ti" filtra listings por state
//   - SearchPage: ordena por cercanía / filtra por state
//   - Topbar: pill "📍 Cuernavaca" + editar
//
// Falla cerrado: si no hay data en localStorage, location = null y los
// consumidores se comportan como "sin ubicación" (muestran todo global).

const STORAGE_KEY = 'xololoBuyerLocation';

const readStorage = () => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.cp) return null;
    return parsed;
  } catch (_) {
    return null;
  }
};

const writeStorage = loc => {
  if (typeof window === 'undefined') return;
  try {
    if (loc) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(loc));
    } else {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  } catch (_) {
    /* ignore */
  }
};

// XOLOLO: TTL para auto-detección por IP. Pasado este tiempo, re-detectamos
// por si el user se movió de estado. Las ubicaciones manuales (source=
// 'manual') NO se re-detectan — el user ya tomó decisión explícita.
const IP_DETECT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 días

export const useBuyerLocation = () => {
  const [location, setLocationState] = useState(() => readStorage());

  // XOLOLO: auto-detecta por IP al mount si no hay location o si expiró.
  // Fire-and-forget — fallo silencioso. El usuario puede sobreescribir
  // manualmente con resolveAndSave en cualquier momento.
  useEffect(() => {
    const current = readStorage();
    if (current?.source === 'manual') return; // respeta elección explícita
    if (current?.setAt && Date.now() - new Date(current.setAt).getTime() < IP_DETECT_TTL_MS) {
      return; // detección IP reciente, no re-detectar
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${apiBaseUrl()}/api/geoip`);
        if (cancelled) return;
        if (res.status === 204) return; // IP fuera de MX o sin data
        if (!res.ok) return;
        const data = await res.json().catch(() => null);
        if (!data?.state) return;
        const loc = {
          cp: data.cp || null,
          state: data.state,
          city: data.city || null,
          lat: data.lat || null,
          lng: data.lng || null,
          setAt: new Date().toISOString(),
          source: 'ip',
        };
        writeStorage(loc);
        setLocationState(loc);
      } catch (_) {
        /* silent */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // XOLOLO: resuelve CP → {state, city, colonies} usando /api/postal-code.
  // Devuelve la location resuelta o null si falla.
  const resolveAndSave = useCallback(async cp => {
    const normalized = String(cp || '').trim();
    if (!/^\d{5}$/.test(normalized)) return null;
    try {
      const res = await fetch(`${apiBaseUrl()}/api/postal-code?cp=${normalized}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.state) return null;
      const loc = {
        cp: normalized,
        state: data.state,
        city: data.city || null,
        setAt: new Date().toISOString(),
        source: 'manual',
      };
      writeStorage(loc);
      setLocationState(loc);
      return loc;
    } catch (_) {
      return null;
    }
  }, []);

  const clearLocation = useCallback(() => {
    writeStorage(null);
    setLocationState(null);
  }, []);

  // Sincroniza entre tabs. Si otro tab actualiza la ubicación, nos
  // enteramos sin reload.
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onStorage = e => {
      if (e.key === STORAGE_KEY) {
        setLocationState(readStorage());
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  return {
    location,
    hasLocation: !!location?.state,
    resolveAndSave,
    clearLocation,
  };
};
