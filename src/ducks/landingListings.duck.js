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

// XOLOLO: 12 listings por sección (antes 6) para que el landing tenga
// más densidad de catálogo visible sin scrollear al rail siguiente.
const RECENT_LISTINGS_LIMIT = 12;

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

export const selectFeaturedProducts = state => {
  const products = state.landingListings.products;
  if (!products?.data?.length) return [];
  // "Productos destacados" sólo muestra nuevos o sin condición declarada.
  // Excluye los usados por las 3 señales de isUsedListing — fuente única
  // de verdad hasta que `condition` exista como field en Console.
  const authorsById = buildAuthorIndex(products.included);
  return products.data
    .filter(l => !isUsedListing(l, authorsById))
    .map((l, i) => listingToFeaturedItem('product', l, products.included, i));
};

export const selectFeaturedServices = state => {
  const services = state.landingListings.services;
  if (!services?.data?.length) return [];
  return services.data.map((l, i) => listingToFeaturedItem('service', l, services.included, i));
};

export const selectFeaturedUsed = state => {
  const used = state.landingListings.used;
  if (!used?.data?.length) return [];
  // Mismo motivo que arriba: el SDK no filtra `pub_condition=used`
  // porque el campo no está registrado en Console. Filtramos en
  // memoria para que la sección sea realmente exclusiva de usados.
  const authorsById = buildAuthorIndex(used.included);
  return used.data
    .filter(l => isUsedListing(l, authorsById))
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
