// XOLOLO: proxy para autocompletar estado / ciudad / colonias desde
// el CP en el checkout. Cliente pasa CP mexicano de 5 dígitos, devuelve
// el listado de opciones para que el buyer sólo elija (menos typos,
// menos error de "buyer_address_incomplete").
//
// Contrato:
//   GET /api/postal-code?cp=62440
//   200 → {
//     postalCode: "62440",
//     state: "Morelos",
//     city: "Cuernavaca",                          // municipio (ahora sí)
//     colonies: ["Acapatzingo", "Alameda", "Amatitlán", ...]  // orden alfabético
//   }
//   400 → { error: 'invalid_cp' }        // no son 5 dígitos
//   404 → { error: 'not_found' }         // CP no existe
//   502 → { error: 'lookup_failed' }
//   504 → { error: 'timeout' }
//
// Auth: no requiere (público para no bloquear a buyers no logueados).
// Rate: caché in-memory LRU (500 entries, 24h TTL) — el CP es
// determinístico, no cambia entre requests, así que un hit vale para
// todos los buyers en el mismo servidor.
//
// Fuente primaria: @webrek/mx-cp — dataset SEPOMEX local (dentro del
// npm package, ~11MB). Sin API key, sin dependencia externa. Devuelve
// estado, municipio (city) y asentamientos con nombre y tipo. Paquete
// ESM-only; lo cargamos con dynamic import desde este módulo CJS.
// Fallback online: api.zippopotam.us (por si un CP nuevo no está en
// el snapshot de SEPOMEX).

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const CACHE_MAX = 500;
const FETCH_TIMEOUT_MS = 4500;

// Estructura Map insertion-order = LRU natural: al leer un hit lo
// re-insertamos para moverlo al final.
const cache = new Map();

const getCached = key => {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.at > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  // touch → mover al final (LRU)
  cache.delete(key);
  cache.set(key, entry);
  return entry.value;
};

const setCached = (key, value) => {
  if (cache.size >= CACHE_MAX) {
    // Eliminar el más antiguo (primero en insertion order).
    const oldestKey = cache.keys().next().value;
    if (oldestKey) cache.delete(oldestKey);
  }
  cache.set(key, { at: Date.now(), value });
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

// Fuente primaria: @webrek/mx-cp (SEPOMEX embebido). ESM-only, así
// que lo cargamos con dynamic import y cacheamos la referencia.
let buscaCPPromise = null;
const getBuscaCP = () => {
  if (!buscaCPPromise) {
    // eslint-disable-next-line no-new-func
    buscaCPPromise = new Function('return import("@webrek/mx-cp")')()
      .then(mod => mod.buscaCP)
      .catch(err => {
        // eslint-disable-next-line no-console
        console.error('[postal-code] no se pudo cargar @webrek/mx-cp:', err?.message);
        buscaCPPromise = null;
        throw err;
      });
  }
  return buscaCPPromise;
};

const lookupFromSepomexLocal = async cp => {
  let buscaCP;
  try {
    buscaCP = await getBuscaCP();
  } catch (e) {
    return null; // paquete no disponible; caemos a fallback online
  }
  const r = await buscaCP(cp);
  if (!r) return null;
  const coloniesRaw = Array.isArray(r.asentamientos)
    ? r.asentamientos.map(a => a?.nombre).filter(Boolean)
    : [];
  const colonies = Array.from(new Set(coloniesRaw)).sort((a, b) => a.localeCompare(b, 'es'));
  return {
    postalCode: cp,
    state: r.estado || null,
    city: r.municipio || r.ciudad || null,
    colonies,
    source: 'sepomex-local',
  };
};

// Fallback: zippopotam.us — sin municipio, pero cubre CPs recientes que
// pueden no estar en el snapshot local.
const lookupFromZippopotam = async cp => {
  const url = `https://api.zippopotam.us/mx/${encodeURIComponent(cp)}`;
  const res = await fetchWithTimeout(url, { headers: { Accept: 'application/json' } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`zippopotam_${res.status}`);
  const data = await res.json();
  const places = Array.isArray(data?.places) ? data.places : [];
  if (places.length === 0) return null;
  const state = places[0]?.state || null;
  const coloniesRaw = places.map(p => p['place name']).filter(Boolean);
  const colonies = Array.from(new Set(coloniesRaw)).sort((a, b) => a.localeCompare(b, 'es'));
  return {
    postalCode: cp,
    state,
    city: null,
    colonies,
    source: 'zippopotam',
  };
};

module.exports = async (req, res) => {
  const cp = String(req.query.cp || '').trim();
  if (!/^\d{5}$/.test(cp)) {
    return res.status(400).json({ error: 'invalid_cp' });
  }

  const hit = getCached(cp);
  if (hit) {
    return res.json({ ...hit, cached: true });
  }

  try {
    let value = null;

    // 1) SEPOMEX local (sync-ish, sin red). Prefiere esto siempre.
    try {
      value = await lookupFromSepomexLocal(cp);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[postal-code] sepomex-local error:', err?.message);
    }

    // 2) Fallback online si el local no tiene el CP (raro, pero por si
    //    Correos actualiza un CP después del snapshot del paquete).
    if (!value) {
      try {
        value = await lookupFromZippopotam(cp);
      } catch (err) {
        if (err?.name === 'AbortError') {
          return res.status(504).json({ error: 'timeout' });
        }
        // eslint-disable-next-line no-console
        console.error('[postal-code] zippopotam error:', err?.message);
        return res.status(502).json({ error: 'lookup_failed' });
      }
    }

    if (!value) {
      return res.status(404).json({ error: 'not_found' });
    }
    setCached(cp, value);
    return res.json(value);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[postal-code] unexpected:', err?.message);
    return res.status(500).json({ error: 'internal' });
  }
};
