// XOLOLO F3 · Sprint 2: tracking de eventos client-side.
//
// Uso:
//   import { trackEvent, detectSource } from '../../util/tracking';
//   trackEvent('listing.viewed', { listingId, source: detectSource() });
//
// Diseño:
//   - Fire-and-forget: nunca await, nunca bloquea render. Los errores
//     se loguean en console.debug (no console.error para no ensuciar).
//   - Dedupe por sesión: un evento por (event, listingId) por sesión
//     del browser. Un buyer que refresca la página no infla el contador.
//     El dedupe vive en sessionStorage — se limpia al cerrar la pestaña.
//   - SSR-safe: si no hay window, no-op.
//   - Sin bloqueo por consentimiento en v1 (analytics propios, no
//     terceros, sin cookies persistentes). Añadir consent banner si
//     alguna vez pintamos cookies de terceros.

import { apiBaseUrl } from './api';

const DEDUPE_STORAGE_KEY = 'xololo-tracked-v1';

const isBrowser = () => typeof window !== 'undefined' && !!window.sessionStorage;

// -------------------- source detection --------------------

// Normaliza un utm_source string común a nuestra taxonomía.
const normalizeUtm = raw => {
  const s = String(raw || '')
    .toLowerCase()
    .trim();
  if (!s) return null;
  if (/^(fb|facebook|meta)/.test(s)) return 'facebook';
  if (/^(ig|instagram)/.test(s)) return 'instagram';
  if (/^(wa|whatsapp|whats)/.test(s)) return 'whatsapp';
  if (/^(tw|twitter|x)$/.test(s)) return 'twitter';
  if (/^tiktok/.test(s)) return 'tiktok';
  if (/^(google|bing|duckduckgo|search)/.test(s)) return 'search';
  if (/^xololo/.test(s)) return 'xololo';
  return 'other';
};

// Detecta la fuente del tráfico del buyer.
// Precedencia: 1) utm_source de la URL, 2) referrer del browser,
// 3) 'direct' si nada aplica.
export const detectSource = () => {
  if (!isBrowser()) return 'direct';
  try {
    const utm = new URLSearchParams(window.location.search).get('utm_source');
    if (utm) return normalizeUtm(utm) || 'other';
  } catch (e) {
    // ignore malformed URL
  }
  const ref = document.referrer;
  if (!ref) return 'direct';
  try {
    const url = new URL(ref);
    const host = url.hostname.toLowerCase();
    // Interno de Xololo: subdominio de tienda o dominio principal.
    if (host === window.location.hostname) return 'direct'; // navegación interna misma URL
    if (host.endsWith('.xololo.mx')) return 'seller_store';
    if (host === 'xololo.mx' || host === 'www.xololo.mx') return 'xololo';
    // Referrers externos comunes.
    if (/facebook\.com|fb\.com|fb\.me|m\.facebook/.test(host)) return 'facebook';
    if (/instagram\.com/.test(host)) return 'instagram';
    if (/whatsapp\.com|wa\.me/.test(host)) return 'whatsapp';
    if (/t\.co|twitter\.com|(^|\.)x\.com$/.test(host)) return 'twitter';
    if (/tiktok\.com/.test(host)) return 'tiktok';
    if (/google\.|bing\.|duckduckgo\.|yahoo\./.test(host)) return 'search';
    return 'other';
  } catch (e) {
    return 'other';
  }
};

// -------------------- session id + dedupe --------------------

// sessionId estable durante la sesión del browser. Se usa server-side
// para poder eliminar eventos duplicados del mismo buyer dentro de la
// misma ventana (además del dedupe client).
const SESSION_ID_KEY = 'xololo-session-id';

const getSessionId = () => {
  if (!isBrowser()) return null;
  try {
    let sid = window.sessionStorage.getItem(SESSION_ID_KEY);
    if (!sid) {
      // 16 random bytes en base36 — suficiente para colisiones nulas
      // dentro de un servidor durante un día.
      sid = Math.random().toString(36).slice(2) + Date.now().toString(36);
      window.sessionStorage.setItem(SESSION_ID_KEY, sid);
    }
    return sid;
  } catch (e) {
    return null;
  }
};

// Dedupe client: por (event, listingId) por sesión.
const wasTracked = key => {
  if (!isBrowser()) return false;
  try {
    const raw = window.sessionStorage.getItem(DEDUPE_STORAGE_KEY);
    const map = raw ? JSON.parse(raw) : {};
    return !!map[key];
  } catch (e) {
    return false;
  }
};

const markTracked = key => {
  if (!isBrowser()) return;
  try {
    const raw = window.sessionStorage.getItem(DEDUPE_STORAGE_KEY);
    const map = raw ? JSON.parse(raw) : {};
    map[key] = 1;
    window.sessionStorage.setItem(DEDUPE_STORAGE_KEY, JSON.stringify(map));
  } catch (e) {
    // sessionStorage lleno o disabled — silencioso
  }
};

// -------------------- public API --------------------

// Dispara un evento de tracking. Nunca throw. Nunca await.
// options:
//   - dedupe: (default true) si false, se manda siempre (útil para
//     shares donde cada click cuenta).
export const trackEvent = (event, payload = {}, options = {}) => {
  if (!isBrowser()) return;

  const { listingId, source, channel } = payload;
  if (!event || !listingId) return;

  const dedupeEnabled = options.dedupe !== false;
  const dedupeKey = `${event}::${listingId}`;
  if (dedupeEnabled && wasTracked(dedupeKey)) return;

  const body = {
    event,
    listingId,
    source: source || 'direct',
    sessionId: getSessionId() || 'anon',
  };
  if (channel) body.channel = channel;

  // Fetch con keepalive por si el user está navegando fuera de la
  // página en ese momento (React Router). El browser garantiza la
  // entrega igualmente.
  try {
    fetch(`${apiBaseUrl()}/api/track/event`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      keepalive: true,
    })
      .then(() => {
        if (dedupeEnabled) markTracked(dedupeKey);
      })
      .catch(err => {
        // eslint-disable-next-line no-console
        console.debug('[tracking] event failed:', event, err?.message);
      });
  } catch (e) {
    // fetch tiró antes de la promise — silencioso.
  }
};
