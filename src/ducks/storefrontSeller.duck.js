import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';

import { createImageVariantConfig } from '../util/sdkLoader';
import { storableError } from '../util/errors';
import { apiBaseUrl } from '../util/api';

// XOLOLO: fetch del seller cuyo slug matchea el subdominio, más sus
// listings publicados. Se dispara al montar la StorefrontPage.
//
// El seller se resuelve por el endpoint /api/seller-by-slug que usa
// Integration API (la Marketplace SDK del cliente no tiene users.query).
// Los listings sí se piden con la SDK del cliente normal.

const RECENT_LISTINGS_LIMIT = 12;

const commonListingsQuery = authorId => ({
  authorId,
  include: ['author', 'images'],
  'fields.image': ['variants.listing-card', 'variants.listing-card-2x'],
  ...createImageVariantConfig('listing-card', 400, 1),
  ...createImageVariantConfig('listing-card-2x', 800, 1),
  perPage: RECENT_LISTINGS_LIMIT,
  sort: '-createdAt',
});

const fetchSellerPayloadCreator = async (
  slug,
  { extra: sdk, rejectWithValue }
) => {
  try {
    const sellerRes = await fetch(`${apiBaseUrl()}/api/seller-by-slug?slug=${encodeURIComponent(slug)}`);
    if (sellerRes.status === 404) {
      return rejectWithValue({ notFound: true });
    }
    if (!sellerRes.ok) {
      return rejectWithValue({ status: sellerRes.status });
    }
    const { seller } = await sellerRes.json();

    // En paralelo, listings del seller para el catálogo del storefront.
    const listingsRes = await sdk.listings.query(commonListingsQuery(seller.id));

    return {
      seller,
      listings: {
        data: listingsRes.data.data || [],
        included: listingsRes.data.included || [],
      },
    };
  } catch (err) {
    return rejectWithValue(storableError(err));
  }
};

export const fetchStorefrontSellerThunk = createAsyncThunk(
  'storefrontSeller/fetchSeller',
  fetchSellerPayloadCreator
);

const initialState = {
  seller: null,
  listings: null,
  inProgress: false,
  notFound: false,
  error: null,
};

const storefrontSellerSlice = createSlice({
  name: 'storefrontSeller',
  initialState,
  reducers: {},
  extraReducers: builder => {
    builder
      .addCase(fetchStorefrontSellerThunk.pending, state => {
        state.inProgress = true;
        state.error = null;
        state.notFound = false;
      })
      .addCase(fetchStorefrontSellerThunk.fulfilled, (state, action) => {
        state.inProgress = false;
        state.seller = action.payload.seller;
        state.listings = action.payload.listings;
      })
      .addCase(fetchStorefrontSellerThunk.rejected, (state, action) => {
        state.inProgress = false;
        if (action.payload?.notFound) {
          state.notFound = true;
        } else {
          state.error = action.payload;
        }
      });
  },
});

export default storefrontSellerSlice.reducer;

export const fetchStorefrontSeller = slug => dispatch =>
  dispatch(fetchStorefrontSellerThunk(slug)).unwrap();

// Selector helpers para transformar listings al shape que usa el grid
// del storefront (similar a FeaturedListings del landing, mismo componente).
const TONES = ['terracotta', 'butter', 'lilac', 'cocoa', 'sand', 'moss', 'rose', 'steel'];

const imageUrlFromListing = (listing, included) => {
  const imageRef = listing.relationships?.images?.data?.[0];
  if (!imageRef) return null;
  const image = included.find(i => i.type === 'image' && i.id.uuid === imageRef.id.uuid);
  const variants = image?.attributes?.variants;
  return variants?.['listing-card-2x']?.url || variants?.['listing-card']?.url || null;
};

const listingToItem = (listing, included, idx) => {
  const slug =
    listing.attributes.title
      ?.toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'listing';
  const listingType = listing.attributes.publicData?.listingType;
  const kind = listingType === 'product' ? 'product' : 'service';
  return {
    id: listing.id.uuid,
    kind,
    name: listing.attributes.title,
    price: listing.attributes.price?.amount
      ? listing.attributes.price.amount / 100
      : undefined,
    imageUrl: imageUrlFromListing(listing, included),
    tone: TONES[idx % TONES.length],
    href: `/l/${slug}/${listing.id.uuid}`,
  };
};

export const selectStorefrontSeller = state => state.storefrontSeller?.seller || null;
export const selectStorefrontInProgress = state => !!state.storefrontSeller?.inProgress;
export const selectStorefrontNotFound = state => !!state.storefrontSeller?.notFound;
export const selectStorefrontListings = state => {
  const listings = state.storefrontSeller?.listings;
  if (!listings?.data?.length) return [];
  return listings.data.map((l, i) => listingToItem(l, listings.included, i));
};
