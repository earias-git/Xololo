import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';

import { storableError } from '../util/errors';
import { apiBaseUrl } from '../util/api';

// XOLOLO: fetch client-side de las tiendas destacadas del landing. Reusa
// el endpoint /api/featured-stores (Integration API con caché). Si el
// endpoint devuelve 0 stores (dev sin config o simplemente sin sellers),
// LandingPage cae al mock estático de src/config/featuredStores.js.

const fetchLandingStoresPayloadCreator = async (_, { rejectWithValue }) => {
  try {
    const res = await fetch(`${apiBaseUrl()}/api/featured-stores?limit=6`);
    if (!res.ok) return rejectWithValue({ status: res.status });
    const data = await res.json();
    return { stores: data.stores || [] };
  } catch (err) {
    return rejectWithValue(storableError(err));
  }
};

export const fetchLandingStoresThunk = createAsyncThunk(
  'landingStores/fetchLandingStores',
  fetchLandingStoresPayloadCreator
);

const initialState = {
  stores: null,
  inProgress: false,
  error: null,
};

const landingStoresSlice = createSlice({
  name: 'landingStores',
  initialState,
  reducers: {},
  extraReducers: builder => {
    builder
      .addCase(fetchLandingStoresThunk.pending, state => {
        state.inProgress = true;
        state.error = null;
      })
      .addCase(fetchLandingStoresThunk.fulfilled, (state, action) => {
        state.inProgress = false;
        state.stores = action.payload.stores;
      })
      .addCase(fetchLandingStoresThunk.rejected, (state, action) => {
        state.inProgress = false;
        state.error = action.payload;
      });
  },
});

export default landingStoresSlice.reducer;

export const fetchLandingStores = () => dispatch =>
  dispatch(fetchLandingStoresThunk()).unwrap();

export const selectLandingStores = state => state.landingStores?.stores || [];
