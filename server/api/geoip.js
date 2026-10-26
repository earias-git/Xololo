// XOLOLO Task #17: resuelve la ubicación aproximada del buyer por IP.
//
// Flow:
//   1. Lee la IP del request (x-forwarded-for en Render; req.ip fallback).
//   2. Cache en memoria por 24h para no golpear al proveedor en cada visit.
//   3. Llama a ip-api.com (gratis, sin API key, 45 req/min por IP server).
//      Si estamos en overflow, cae a null — el frontend igual puede pedir
//      CP manualmente.
//   4. Filtra países: sólo devuelve ubicación si es México. Extranjeros ven
//      el landing sin personalización geo (no queremos auto-asignarles un
//      estado MX).
//
// Contrato:
//   GET /api/geoip
//   200 → { state, city, cp?, lat?, lng?, source: 'ip' }
//   204 → sin contenido (IP fuera de MX, privada, o proveedor caído)

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const cache = new Map(); // ip → { data, at }

const extractClientIp = req => {
  // Render / proxies ponen la IP real en x-forwarded-for (coma-separado;
  // la primera es la del cliente real).
  const xff = req.headers['x-forwarded-for'];
  if (xff) {
    const first = String(xff).split(',')[0].trim();
    if (first) return first;
  }
  return req.ip || req.connection?.remoteAddress || null;
};

const isPrivateIp = ip => {
  if (!ip) return true;
  // IPv4 privados o localhost / IPv6 locales.
  if (ip === '::1' || ip.startsWith('127.') || ip === 'localhost') return true;
  if (/^10\./.test(ip) || /^192\.168\./.test(ip)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return true;
  if (/^fc|^fd|^fe80:/i.test(ip)) return true;
  return false;
};

const lookupIp = async ip => {
  // ip-api.com free tier: HTTP sin SSL. Server-side es aceptable.
  // Fields acotados para reducir latencia + no exponer data innecesaria.
  const url = `http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,country,countryCode,regionName,city,zip,lat,lon,query`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    const data = await res.json();
    if (data?.status !== 'success') return null;
    if (data.countryCode !== 'MX') return null;
    return {
      state: data.regionName || null,
      city: data.city || null,
      cp: data.zip || null,
      lat: typeof data.lat === 'number' ? data.lat : null,
      lng: typeof data.lon === 'number' ? data.lon : null,
      source: 'ip',
    };
  } catch (_) {
    return null;
  } finally {
    clearTimeout(timeout);
  }
};

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });

  const ip = extractClientIp(req);
  if (!ip || isPrivateIp(ip)) {
    return res.status(204).end();
  }

  const now = Date.now();
  const cached = cache.get(ip);
  if (cached && now - cached.at < CACHE_TTL_MS) {
    if (!cached.data) return res.status(204).end();
    return res.json(cached.data);
  }

  const data = await lookupIp(ip);
  cache.set(ip, { data, at: now });
  if (!data) return res.status(204).end();
  return res.json(data);
};
