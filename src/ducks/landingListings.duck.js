import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';

import { createImageVariantConfig } from '../util/sdkLoader';
import { storableError } from '../util/errors';

// XOLOLO: fetch de los últimos listings publicados (productos y servicios)
// para el landing. Se dispara al montar la LandingPage y alimenta las
// secciones "Productos destacados" y "Servicios populares" con datos
// reales del marketplace en vez de los placeholders de config.
//
// Es client-side por ahora (no SSR) — para SEO/first paint conviene migrar
// a loadData en una iteración futura. Pero visualmente el usuario ve las
// listings reales apenas hidrata.

// XOLOLO: 24 listings crudos por bucket. Después del filtro cliente
// (quitar eventos/usados en productos, parear ubicación, etc.) nos
// quedamos con suficiente material para llenar 12 slots por riel aunque
// se caiga la mitad al filtro.
const RECENT_LISTINGS_LIMIT = 24;

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

const commonQueryParams = () => ({
  include: ['author', 'images'],
  'fields.image': ['variants.listing-card', 'variants.listing-card-2x'],
  ...createImageVariantConfig('listing-card', 400, 1),
  ...createImageVariantConfig('listing-card-2x', 800, 1),
  perPage: RECENT_LISTINGS_LIMIT,
  // XOLOLO: la Sharetribe Marketplace API responde invertido respecto a
  // su documentación — `sort: 'createdAt'` (sin prefijo) devuelve DESC
  // (más nuevos primero), que es lo que queremos aquí. Verificado contra
  // los 8 productos reales del marketplace en producción: con '-createdAt'
  // el producto más nuevo (Diadema FLORES, 6-oct) salía al final y el
  // landing dejaba de mostrarlo. Con 'createdAt' sale primero correcto.
  sort: 'createdAt',
});

const fetchLandingListingsPayloadCreator = async (_, { extra: sdk, rejectWithValue }) => {
  try {
    const [productsRes, servicesRes, usedRes] = await Promise.all([
      sdk.listings.query({ pub_listingType: 'product', ...commonQueryParams() }),
      sdk.listings.query({
        pub_listingType: 'service,service-day',
        ...commonQueryParams(),
      }),
      // XOLOLO: tercera query para la sección "Segunda mano destacada" del
      // landing. Filtra por publicData.condition='used' Y SÓLO productos
      // (los servicios no tienen condición, y si algún servicio quedó con
      // condition='used' por un submit viejo no debe aparecer aquí).
      sdk.listings.query({
        pub_condition: 'used',
        pub_listingType: 'product',
        ...commonQueryParams(),
      }),
    ]);
    return {
      products: {
        data: productsRes.data.data || [],
        included: productsRes.data.included || [],
      },
      services: {
        data: servicesRes.data.data || [],
        included: servicesRes.data.included || [],
      },
      used: {
        data: usedRes.data.data || [],
        included: usedRes.data.included || [],
      },
    };
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
  return (
    variants?.['listing-card-2x']?.url ||
    variants?.['listing-card']?.url ||
    null
  );
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
    price: listing.attributes.price?.amount
      ? listing.attributes.price.amount / 100
      : undefined,
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
  'cdmx': 'ciudad de mexico',
  'df': 'ciudad de mexico',
  'd.f.': 'ciudad de mexico',
  'distrito federal': 'ciudad de mexico',
  'mexico city': 'ciudad de mexico',
  'edomex': 'estado de mexico',
  'estado de mexico': 'estado de mexico',
  'estado de méxico': 'estado de mexico',
  'edo. mex.': 'estado de mexico',
  'edo mex': 'estado de mexico',
  'baja california norte': 'baja california',
  'bcs': 'baja california sur',
  'bc': 'baja california',
  'qroo': 'quintana roo',
  'q. roo': 'quintana roo',
  'nl': 'nuevo leon',
  'slp': 'san luis potosi',
};

// Lista canónica normalizada — para substring match contra una dirección.
const CANONICAL_STATES_NORM = [
  'aguascalientes', 'baja california sur', 'baja california', 'campeche',
  'chiapas', 'chihuahua', 'ciudad de mexico', 'coahuila', 'colima',
  'durango', 'estado de mexico', 'guanajuato', 'guerrero', 'hidalgo',
  'jalisco', 'michoacan', 'morelos', 'nayarit', 'nuevo leon', 'oaxaca',
  'puebla', 'queretaro', 'quintana roo', 'san luis potosi', 'sinaloa',
  'sonora', 'tabasco', 'tamaulipas', 'tlaxcala', 'veracruz', 'yucatan',
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
const isEventListing = listing =>
  listing?.attributes?.publicData?.isEvent === true;

// XOLOLO Task #17: filtra listings al estado del buyer con fallback.
// Si !buyerState, devuelve la lista tal cual (sin ubicación → oferta
// global). Si hay buyerState Y hay matches → devuelve sólo los locales.
// Si hay buyerState pero NO hay matches → cae a la lista completa en
// vez de vaciar el riel (bug detectado 2026-10-27: el riel se vaciaba
// y el landing mostraba placeholders).
const filterByBuyerState = (listingsArr, buyerState, authorsById) => {
  if (!buyerState || !listingsArr?.length) return listingsArr || [];
  const filtered = listingsArr.filter(l =>
    listingMatchesBuyerState(l, buyerState, authorsById)
  );
  // Fallback: si no hay locales, muestra la oferta global en vez de
  // dejar el riel vacío (que cae a placeholders).
  return filtered.length > 0 ? filtered : listingsArr;
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
  const base = products.data.filter(
    l => !isUsedListing(l, authorsById) && !isEventListing(l)
  );
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
export const selectLandingListingsLoading = state =>
  state.landingListings?.inProgress === true;

// Backward compat action creator wrapper
export const fetchLandingListings = () => dispatch =>
  dispatch(fetchLandingListingsThunk()).unwrap();
