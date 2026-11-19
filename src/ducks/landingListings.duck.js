import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';

import { types as sdkTypes } from '../util/sdkLoader';
import { storableError } from '../util/errors';
import { apiBaseUrl } from '../util/api';

// XOLOLO LOCKED — ADR-005: la LandingPage hidrata vía un solo
// fetch al endpoint propio /api/landing-listings. El filtrado
// (siblings, events, 3 señales de usado) vive 100% en el server.
// Ver docs/decisions/ADR-005-landing-hydration.md.
//
// Cambios al fetcher o al shape {products, services, used} requieren
// actualizar el ADR y los smoke tests
// (server/smoke/landingListings.smoke.test.js).
//
// Es client-side por ahora (no SSR) — para SEO/first paint conviene
// migrar a loadData en una iteración futura.

// XOLOLO 2026-11-18 — RECENT_LISTINGS_LIMIT ya no se usa. El
// server pagina lo necesario y devuelve el shape listo (ver
// server/api-util/landingListingsService.js + server/api/landing-listings.js).
// Se mantiene la constante aquí porque algún selector legacy podría
// referenciarla; eliminar en limpieza posterior cuando se audite.

// XOLOLO: tope visible por riel. Se aplica en los selectores después
// de filtrar y reordenar, para que la UI siempre vea un número parejo.
const VISIBLE_PER_RAIL = 12;

// Paleta de tonos para el thumbnail placeholder cuando no hay imagen.
// El componente FeaturedListings usa `tone` para pintar el gradiente.
const TONES = [
  'terracotta',
  'butter',
  'lilac',
  'cocoa',
  'sand',
  'moss',
  'rose',
  'steel',
  'honey',
  'ocean',
  'violet',
  'jade',
];

// XOLOLO 2026-11-18 — un solo fetch al endpoint server-side
// /api/landing-listings. El server pagina, filtra siblings y
// devuelve el shape {products, services, used} con data+included
// deserializado al formato Sharetribe. Zero filtros cliente
// necesarios.
//
// Ventajas vs. 3 queries sdk.listings.query directo:
// - 1 round-trip en vez de 3.
// - Server pagina internamente hasta reunir N válidos (no se
//   satura de siblings).
// - Cache in-memory 60s + Cache-Control 30s, reduce carga en
//   Sharetribe cuando varios buyers cargan landing simultáneo.
// - Lógica de filtrado centralizada (sibling, event, used) en
//   server/api-util/landingListingsService.js.

// Re-deserializa el payload del endpoint server para que las
// UUIDs/Money/LatLng vuelvan a ser instancias del SDK (como las
// que devolvía sdk.listings.query). Sharetribe Integration SDK
// las serializa a un formato JSON plano con un `_sdkType` marker.
const reviveSdkTypes = obj => {
  if (Array.isArray(obj)) return obj.map(reviveSdkTypes);
  if (obj && typeof obj === 'object') {
    if (obj._sdkType === 'UUID' && obj.uuid) return new sdkTypes.UUID(obj.uuid);
    if (obj._sdkType === 'Money' && typeof obj.amount === 'number' && obj.currency) {
      return new sdkTypes.Money(obj.amount, obj.currency);
    }
    if (obj._sdkType === 'LatLng' && typeof obj.lat === 'number' && typeof obj.lng === 'number') {
      return new sdkTypes.LatLng(obj.lat, obj.lng);
    }
    if (obj._sdkType === 'BigDecimal' && obj.value) return new sdkTypes.BigDecimal(obj.value);
    const out = {};
    for (const k of Object.keys(obj)) out[k] = reviveSdkTypes(obj[k]);
    return out;
  }
  return obj;
};

const fetchLandingListingsPayloadCreator = async (_, { rejectWithValue }) => {
  try {
    const url = `${apiBaseUrl()}/api/landing-listings`;
    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      return rejectWithValue(storableError(new Error(`landing-listings HTTP ${res.status}: ${txt}`)));
    }
    const payload = await res.json();
    // Server ya devuelve {products, services, used}; revive SDK types.
    return reviveSdkTypes(payload);
  } catch (err) {
    return rejectWithValue(storableError(err));
  }
};

export const fetchLandingListingsThunk = createAsyncThunk(
  'landingListings/fetchLandingListings',
  fetchLandingListingsPayloadCreator
);

const initialState = {
  products: null,
  services: null,
  used: null,
  inProgress: false,
  error: null,
};

const landingListingsSlice = createSlice({
  name: 'landingListings',
  initialState,
  reducers: {},
  extraReducers: builder => {
    builder
      .addCase(fetchLandingListingsThunk.pending, state => {
        state.inProgress = true;
        state.error = null;
      })
      .addCase(fetchLandingListingsThunk.fulfilled, (state, action) => {
        state.inProgress = false;
        state.products = action.payload.products;
        state.services = action.payload.services;
        state.used = action.payload.used;
      })
      .addCase(fetchLandingListingsThunk.rejected, (state, action) => {
        state.inProgress = false;
        state.error = action.payload;
      });
  },
});

export default landingListingsSlice.reducer;

// Selector helpers — convierten la respuesta del SDK al shape que espera
// el componente FeaturedListings: { id, kind, name, seller, price, tone, href }.

const imageUrlFromListing = (listing, included) => {
  const imageRef = listing.relationships?.images?.data?.[0];
  if (!imageRef) return null;
  const image = included.find(i => i.type === 'image' && i.id.uuid === imageRef.id.uuid);
  const variants = image?.attributes?.variants;
  return variants?.['listing-card-2x']?.url || variants?.['listing-card']?.url || null;
};

const authorNameFromListing = (listing, included) => {
  const authorRef = listing.relationships?.author?.data;
  if (!authorRef) return null;
  const user = included.find(i => i.type === 'user' && i.id.uuid === authorRef.id.uuid);
  return user?.attributes?.profile?.displayName || null;
};

const listingToFeaturedItem = (kind, listing, included, idx) => {
  const slug =
    listing.attributes.title
      ?.toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'listing';
  return {
    id: listing.id.uuid,
    kind,
    name: listing.attributes.title,
    seller: authorNameFromListing(listing, included),
    price: listing.attributes.price?.amount ? listing.attributes.price.amount / 100 : undefined,
    imageUrl: imageUrlFromListing(listing, included),
    tone: TONES[idx % TONES.length],
    href: `/l/${slug}/${listing.id.uuid}`,
  };
};

// XOLOLO: `pub_condition=used` del SDK NO filtra correctamente porque
// `condition` no está registrado como listing field en Sharetribe
// Console (Build → Listings → Listing fields). Como consecuencia la
// query trae todos los productos y hay que filtrar en memoria.
//
// Detectamos "usado" por 3 señales (OR):
//  a) publicData.condition === 'used' — el pricing panel lo persiste.
//  b) publicData.taxClassification.code === 'exento_9_iv' — Art. 9 IV
//     LIVA SÓLO aplica a bienes usados por particular ocasional.
//  c) El author del listing es sellerMode='casual_reseller' — el casual
//     SÓLO puede publicar usado por definición (único modo que tiene).
//     Captura listings viejos donde ni condition ni taxClassification
//     quedaron persistidos (bugs del wizard previo al fix de casual).
//
// Cuando se registre `condition` en Console, el filtro server-side
// empezará a funcionar y este filtro en memoria queda como seguro
// redundante.
const buildAuthorIndex = included => {
  const idx = new Map();
  (included || []).forEach(inc => {
    if (inc.type === 'user') idx.set(inc.id.uuid, inc);
  });
  return idx;
};

const isUsedListing = (listing, authorsById) => {
  const pd = listing.attributes?.publicData || {};
  if (pd.condition === 'used') return true;
  if (pd.taxClassification?.code === 'exento_9_iv') return true;
  // Señal (c): el seller es casual_reseller — todos sus listings son usados.
  if (authorsById) {
    const authorId = listing.relationships?.author?.data?.id?.uuid;
    const author = authorId ? authorsById.get(authorId) : null;
    const sellerMode = author?.attributes?.profile?.publicData?.sellerMode;
    if (sellerMode === 'casual_reseller') return true;
  }
  return false;
};

// XOLOLO Task #17: catálogo de estados MX con alias comunes.
// Normalizador: minúsculas sin acentos, para comparar strings aunque la
// fuente use "Michoacan" vs "Michoacán", "CDMX" vs "Ciudad de México", etc.
const normalizeStr = s =>
  String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim();

// Mapa alias → nombre canónico. Las variantes que vemos en la vida real
// vienen de ip-api.com (regionName) y de Google Places (address string).
const STATE_ALIASES = {
  cdmx: 'ciudad de mexico',
  df: 'ciudad de mexico',
  'd.f.': 'ciudad de mexico',
  'distrito federal': 'ciudad de mexico',
  'mexico city': 'ciudad de mexico',
  edomex: 'estado de mexico',
  'estado de mexico': 'estado de mexico',
  'estado de méxico': 'estado de mexico',
  'edo. mex.': 'estado de mexico',
  'edo mex': 'estado de mexico',
  'baja california norte': 'baja california',
  bcs: 'baja california sur',
  bc: 'baja california',
  qroo: 'quintana roo',
  'q. roo': 'quintana roo',
  nl: 'nuevo leon',
  slp: 'san luis potosi',
};

// Lista canónica normalizada — para substring match contra una dirección.
const CANONICAL_STATES_NORM = [
  'aguascalientes',
  'baja california sur',
  'baja california',
  'campeche',
  'chiapas',
  'chihuahua',
  'ciudad de mexico',
  'coahuila',
  'colima',
  'durango',
  'estado de mexico',
  'guanajuato',
  'guerrero',
  'hidalgo',
  'jalisco',
  'michoacan',
  'morelos',
  'nayarit',
  'nuevo leon',
  'oaxaca',
  'puebla',
  'queretaro',
  'quintana roo',
  'san luis potosi',
  'sinaloa',
  'sonora',
  'tabasco',
  'tamaulipas',
  'tlaxcala',
  'veracruz',
  'yucatan',
  'zacatecas',
];

// XOLOLO: extrae el estado MX de un listing. Prioriza author.publicData.
// sellerLocation.state (campo que el seller llenará en onboarding), y
// como fallback parsea publicData.location.address del propio listing
// (string tipo "Calle, Colonia, Cuernavaca, Morelos 62000, México").
const extractListingState = (listing, authorsById) => {
  // 1) author.publicData.sellerLocation.state
  if (authorsById) {
    const authorId = listing.relationships?.author?.data?.id?.uuid;
    const author = authorId ? authorsById.get(authorId) : null;
    const sellerState = author?.attributes?.profile?.publicData?.sellerLocation?.state;
    if (sellerState) {
      const norm = normalizeStr(sellerState);
      return STATE_ALIASES[norm] || norm;
    }
  }
  // 2) parse publicData.location.address
  const addr = listing.attributes?.publicData?.location?.address;
  if (!addr) return null;
  const addrNorm = normalizeStr(addr);
  // Ordenamos los nombres canónicos de más largo a más corto para que
  // "baja california sur" matchee antes que "baja california".
  const byLen = [...CANONICAL_STATES_NORM].sort((a, b) => b.length - a.length);
  for (const st of byLen) {
    if (addrNorm.includes(st)) return st;
  }
  // 3) intentar alias (ej. "CDMX")
  for (const [alias, canonical] of Object.entries(STATE_ALIASES)) {
    const re = new RegExp(`\\b${alias.replace(/\./g, '\\.')}\\b`);
    if (re.test(addrNorm)) return canonical;
  }
  return null;
};

// XOLOLO: compara el estado de un listing con el estado del buyer (IP o
// manual). Normaliza ambos y aplica aliases.
export const listingMatchesBuyerState = (listing, buyerState, authorsById) => {
  if (!buyerState) return false;
  const buyerNorm = STATE_ALIASES[normalizeStr(buyerState)] || normalizeStr(buyerState);
  const listingNorm = extractListingState(listing, authorsById);
  if (!listingNorm) return false;
  return listingNorm === buyerNorm;
};

// XOLOLO: un listing es "evento con fecha fija" si publicData.isEvent=true.
// Se persiste como listingType='product' real (pseudo-tipo event-ticket se
// mapea al submit), por eso vive en el fetch de products — pero NO debe
// aparecer en el riel "Productos destacados" (es un servicio temporal,
// no un objeto físico). Lo re-canalizamos a la sección Servicios.
const isEventListing = listing => listing?.attributes?.publicData?.isEvent === true;

// XOLOLO Task #17: reordena listings poniendo primero los que matchean
// con el estado del buyer y completa con el resto. NO filtra: si el
// buyer está en CDMX y hay 7 listings de los cuales 1 es de CDMX, el
// riel muestra ese 1 primero + los otros 6 después (hasta VISIBLE_PER_RAIL),
// no sólo el local. Sin buyerState → orden original del server (fecha).
//
// Bug previo (fix 2026-11-03): esta función hacía `filter`, no `sort`.
// Resultado: con 7 servicios y buyer en estado con 1 match, el riel
// mostraba 1 solo "Servicio popular". Confunde al visitante y oculta
// inventario real. La promesa del task #17 era priorizar lo local, no
// esconder lo global.
const filterByBuyerState = (listingsArr, buyerState, authorsById) => {
  if (!listingsArr?.length) return listingsArr || [];
  if (!buyerState) return listingsArr;
  const locals = [];
  const rest = [];
  listingsArr.forEach(l => {
    if (listingMatchesBuyerState(l, buyerState, authorsById)) {
      locals.push(l);
    } else {
      rest.push(l);
    }
  });
  return [...locals, ...rest];
};

// XOLOLO: factory selector. Cuando buyerState está presente, los
// matches del estado del buyer salen primero en el riel; el resto
// completa hasta llenar la vista. Si no hay buyerState: comportamiento
// original (orden del server por fecha).
export const selectFeaturedProducts = (buyerState = null) => state => {
  const products = state.landingListings.products;
  if (!products?.data?.length) return [];
  // "Productos destacados" sólo muestra nuevos o sin condición declarada.
  // Excluye los usados por las 3 señales de isUsedListing — fuente única
  // de verdad hasta que `condition` exista como field en Console.
  // También excluye eventos (van a la sección Servicios).
  const authorsById = buildAuthorIndex(products.included);
  const base = products.data.filter(l => !isUsedListing(l, authorsById) && !isEventListing(l));
  const ordered = filterByBuyerState(base, buyerState, authorsById);
  return ordered
    .slice(0, VISIBLE_PER_RAIL)
    .map((l, i) => listingToFeaturedItem('product', l, products.included, i));
};

export const selectFeaturedServices = (buyerState = null) => state => {
  const services = state.landingListings.services;
  const products = state.landingListings.products;

  // Combina servicios clásicos + eventos (publicData.isEvent) en una
  // sola lista cruda para reordenar coherentemente por ubicación.
  const combined = [];
  const includedByListingId = new Map();
  if (services?.data?.length) {
    services.data.forEach(l => {
      combined.push(l);
      includedByListingId.set(l.id.uuid, services.included);
    });
  }
  if (products?.data?.length) {
    products.data.forEach(l => {
      if (!isEventListing(l)) return;
      combined.push(l);
      includedByListingId.set(l.id.uuid, products.included);
    });
  }

  // Author index desde ambos buckets para resolver sellerLocation.state
  // sin importar de dónde vino el listing.
  const authorsById = new Map();
  (services?.included || []).forEach(i => {
    if (i.type === 'user') authorsById.set(i.id.uuid, i);
  });
  (products?.included || []).forEach(i => {
    if (i.type === 'user') authorsById.set(i.id.uuid, i);
  });

  const ordered = filterByBuyerState(combined, buyerState, authorsById);
  return ordered
    .slice(0, VISIBLE_PER_RAIL)
    .map((l, i) =>
      listingToFeaturedItem('service', l, includedByListingId.get(l.id.uuid) || [], i)
    );
};

export const selectFeaturedUsed = (buyerState = null) => state => {
  const used = state.landingListings.used;
  if (!used?.data?.length) return [];
  // Mismo motivo que arriba: el SDK no filtra `pub_condition=used`
  // porque el campo no está registrado en Console. Filtramos en
  // memoria para que la sección sea realmente exclusiva de usados.
  const authorsById = buildAuthorIndex(used.included);
  const base = used.data.filter(l => isUsedListing(l, authorsById));
  const ordered = filterByBuyerState(base, buyerState, authorsById);
  return ordered
    .slice(0, VISIBLE_PER_RAIL)
    .map((l, i) => listingToFeaturedItem('used', l, used.included, i));
};

// XOLOLO: expone el flag de loading para que la UI distinga "fetching"
// de "vacío". Evita el flash de mockups mientras los listings reales
// cargan: la LandingPage pasa items=[] a FeaturedListings durante el
// fetch (el componente se auto-oculta) y sólo cae al placeholder si el
// fetch terminó sin resultados.
export const selectLandingListingsLoading = state => state.landingListings?.inProgress === true;

// XOLOLO 2026-11-19 — helpers reutilizados por CommunityLandingPage
// para dividir en 3 rieles con los mismos criterios que el landing
// principal. Expuestos deliberadamente aquí para no duplicar lógica.
export {
  listingToFeaturedItem,
  isUsedListing,
  isEventListing,
  buildAuthorIndex,
  filterByBuyerState,
  VISIBLE_PER_RAIL,
};

// Backward compat action creator wrapper
export const fetchLandingListings = () => dispatch =>
  dispatch(fetchLandingListingsThunk()).unwrap();
