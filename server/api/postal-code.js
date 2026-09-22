// XOLOLO: proxy para autocompletar estado / colonias desde el CP en el
// checkout. Cliente pasa CP mexicano de 5 dígitos, devuelve el listado
// de opciones para que el buyer sólo elija (menos typos, menos error
// de "buyer_address_incomplete").
//
// Contrato:
//   GET /api/postal-code?cp=62790
//   200 → {
//     postalCode: "62790",
//     state: "Morelos",
//     city: null,                          // se deja al buyer (municipio no viene en Zippopotam)
//     colonies: ["3 de Mayo", "Alpuyeca", "Benito Juarez", ...]  // orden alfabético
//   }
//   400 → { error: 'invalid_cp' }        // no son 5 dígitos
//   404 → { error: 'not_found' }         // CP no existe
//   502 → { error: 'lookup_failed' }
//   504 → { error: 'timeout' }
//
// Auth: no requiere (público para no bloquear a buyers no logueados).
// Rate: caché in-memory LRU (500 entries, 24h TTL) — el CP es
// determinístico, no cambia entre requests, así que un hit vale para
// todos los buyers en el mismo servidor. Suficiente para v1.
//
// Fuente primaria: api.zippopotam.us — DNS estable, sin key requerida,
// trae `places[]` (una entrada por colonia) con state. NO trae ciudad
// (municipio) de forma limpia — para México cada "place" es colonia.
// Fallback: sepomex.icalialabs.com (open-source SEPOMEX; a veces down).

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

// Fuente primaria: zippopotam.us. `places[]` = una entrada por colonia
// (así modela México). No trae municipio; dejamos city:null y el buyer
// lo teclea (o lo autocompletamos con el nombre de la colonia elegida).
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

// Fallback: SEPOMEX icalialabs (a veces down). Sí trae municipio.
const lookupFromSepomex = async cp => {
  const url = `https://sepomex.icalialabs.com/api/v1/zip_codes?zip_code=${encodeURIComponent(cp)}`;
  const res = await fetchWithTimeout(url, {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`sepomex_${res.status}`);
  const data = await res.json();
  const rows = Array.isArray(data?.zip_codes) ? data.zip_codes : [];
  if (rows.length === 0) return null;
  const first = rows[0];
  const coloniesRaw = rows.map(r => r.d_asenta).filter(Boolean);
  const colonies = Array.from(new Set(coloniesRaw)).sort((a, b) => a.localeCompare(b, 'es'));
  return {
    postalCode: cp,
    state: first.d_estado || null,
    city: first.d_mnpio || first.d_ciudad || null,
    colonies,
    source: 'sepomex',
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
    try {
      value = await lookupFromZippopotam(cp);
    } catch (err) {
      if (err?.name === 'AbortError') {
        // eslint-disable-next-line no-console
        console.warn('[postal-code] zippopotam timeout — probando sepomex');
      } else {
        // eslint-disable-next-line no-console
        console.warn('[postal-code] zippopotam error:', err?.message);
      }
      // Continue al fallback abajo.
    }
    if (!value) {
      try {
        value = await lookupFromSepomex(cp);
      } catch (err) {
        if (err?.name === 'AbortError') {
          return res.status(504).json({ error: 'timeout' });
        }
        // eslint-disable-next-line no-console
        console.error('[postal-code] sepomex error:', err?.message);
        // Si el primario ya falló Y el fallback también → 502.
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
