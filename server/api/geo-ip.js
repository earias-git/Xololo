// XOLOLO: geo-IP hint para filtrar/advertir localDelivery en el
// ListingPage/CartPage cuando el estado detectado del buyer no está
// en coverageStates del listing. NO es un filtro duro — el gate real
// vive en el checkout con CP + estado del buyer (ver
// src/util/localDeliveryCoverage.js).
//
// Fuente: ipapi.co (free tier, 1000 req/día sin API key). Cache
// in-memory LRU por IP (24h TTL) — el CP/geo raramente cambia y muchas
// requests vienen de las mismas IPs (retornos del mismo buyer).
//
// Contrato:
//   GET /api/geo-ip
//   200 → {
//     country: 'MX' | null,
//     state:   'Morelos' | null,     // normalized MX_STATES o null
//     city:    'Cuernavaca' | null,
//     source:  'ipapi' | 'cache' | 'fallback',
//   }
//
// Fallback graceful: si el fetch falla (timeout, rate limit, red down),
// devolvemos { country: null } sin error 500 — el UI muestra todas
// las opciones como si no hubiera hint. Cero downtime.

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_MAX = 1000;
const FETCH_TIMEOUT_MS = 3000;

const cache = new Map();
const getCached = key => {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.at > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  cache.delete(key);
  cache.set(key, entry);
  return entry.value;
};
const setCached = (key, value) => {
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(key, { at: Date.now(), value });
};

// Extrae la IP real detrás de proxy/CDN (Render pone la IP del cliente
// en X-Forwarded-For separado por comas; el primer elemento es el
// cliente original).
const getClientIp = req => {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0].trim();
  }
  return req.ip || req.connection?.remoteAddress || null;
};

// Normaliza el nombre del estado que devuelve ipapi.co al formato
// canónico MX_STATES (SEPOMEX). ipapi.co usa nombres oficiales que
// suelen coincidir; para variantes hacemos un mapa.
const ESTADO_ALIAS = {
  'Coahuila de Zaragoza': 'Coahuila',
  'México': 'Estado de México',
  'Mexico': 'Estado de México',
  'Michoacán de Ocampo': 'Michoacán',
  'Veracruz de Ignacio de la Llave': 'Veracruz',
  'Distrito Federal': 'Ciudad de México',
  'CDMX': 'Ciudad de México',
};

const fetchWithTimeout = async (url, opts = {}) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...opts, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
};

module.exports = async (req, res) => {
  try {
    const ip = getClientIp(req);
    // IPs privadas / loopback (dev local) — devolvemos vacío sin llamar
    // a ipapi. Reconocimiento simplificado: 127.*, ::1, 10.*, 172.16-31.*,
    // 192.168.* — cubre los casos comunes de dev.
    const isPrivate =
      !ip ||
      /^127\./.test(ip) ||
      ip === '::1' ||
      /^10\./.test(ip) ||
      /^192\.168\./.test(ip) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(ip);
    if (isPrivate) {
      return res.json({ country: null, state: null, city: null, source: 'fallback' });
    }

    const cached = getCached(ip);
    if (cached) return res.json({ ...cached, source: 'cache' });

    let response;
    try {
      response = await fetchWithTimeout(`https://ipapi.co/${encodeURIComponent(ip)}/json/`, {
        headers: { 'User-Agent': 'xololo.mx/1.0' },
      });
    } catch (e) {
      // Timeout o red down — fallback.
      return res.json({ country: null, state: null, city: null, source: 'fallback' });
    }
    if (!response.ok) {
      return res.json({ country: null, state: null, city: null, source: 'fallback' });
    }
    const data = await response.json().catch(() => ({}));
    // ipapi.co rate limit devuelve { error: true, reason: 'RateLimited' }
    // con 200 — verificamos.
    if (data.error) {
      return res.json({ country: null, state: null, city: null, source: 'fallback' });
    }
    const rawState = data.region || null;
    const normalizedState = rawState ? ESTADO_ALIAS[rawState] || rawState : null;
    const result = {
      country: data.country_code || null,
      state: normalizedState,
      city: data.city || null,
    };
    setCached(ip, result);
    return res.json({ ...result, source: 'ipapi' });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[geo-ip] unexpected:', e?.message);
    return res.json({ country: null, state: null, city: null, source: 'fallback' });
  }
};
