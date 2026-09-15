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

const RECENT_LISTINGS_LIMIT = 6;

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
  sort: '-createdAt',
});

const fetchLandingListingsPayloadCreator = async (_, { extra: sdk, rejectWithValue }) => {
  try {
    const [productsRes, servicesRes] = await Promise.all([
      sdk.listings.query({ pub_listingType: 'product', ...commonQueryParams() }),
      sdk.listings.query({
        pub_listingType: 'service,service-day',
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

export const selectFeaturedProducts = state => {
  const products = state.landingListings.products;
  if (!products?.data?.length) return [];
  return products.data.map((l, i) => listingToFeaturedItem('product', l, products.included, i));
};

export const selectFeaturedServices = state => {
  const services = state.landingListings.services;
  if (!services?.data?.length) return [];
  return services.data.map((l, i) => listingToFeaturedItem('service', l, services.included, i));
};

// Backward compat action creator wrapper
export const fetchLandingListings = () => dispatch =>
  dispatch(fetchLandingListingsThunk()).unwrap();
