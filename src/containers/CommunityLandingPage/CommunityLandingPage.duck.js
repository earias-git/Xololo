// XOLOLO 2026-11-18 — ADR-006 PR-6: duck de la CommunityLandingPage.
//
// Hidrata la landing /comunidad/:slug (y /region/*, /programa/*).
// Un sólo fetch a /api/communities/:slug devuelve {community, listings}.
//
// SSR via loadData (registrado en pageDataLoadingAPI.js). En cliente
// también se dispara por si llegamos sin SSR (navegación interna).

import { createSlice } from '@reduxjs/toolkit';

import { types as sdkTypes } from '../../util/sdkLoader';
import { storableError } from '../../util/errors';
import { apiBaseUrl } from '../../util/api';

// Revive instancias del SDK desde el JSON plano que devuelve el
// endpoint server (mismo helper que landingListings.duck.js).
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

// ====== slice ======

const initialState = {
  community: null,
  listings: null, // { data, included, meta }
  inProgress: false,
  error: null,
  notFound: false,
};

const slice = createSlice({
  name: 'CommunityLandingPage',
  initialState,
  reducers: {
    communityLoadStart: state => {
      state.inProgress = true;
      state.error = null;
      state.notFound = false;
    },
    communityLoadSuccess: (state, action) => {
      state.inProgress = false;
      state.community = action.payload.community;
      state.listings = action.payload.listings;
    },
    communityLoadNotFound: state => {
      state.inProgress = false;
      state.notFound = true;
      state.community = null;
      state.listings = null;
    },
    communityLoadFailed: (state, action) => {
      state.inProgress = false;
      state.error = action.payload;
    },
    communityLoadClear: () => initialState,
  },
});

export const {
  communityLoadStart,
  communityLoadSuccess,
  communityLoadNotFound,
  communityLoadFailed,
  communityLoadClear,
} = slice.actions;

export default slice.reducer;

// ====== loadData ======
//
// Firma estándar del codebase: loadData(params, search, config)
// → thunk. Params incluye :slug. Para distinguir el type del URL
// (sectorial / geografica / modelo), pasamos la ruta vía search o
// via un wrapper en pageDataLoadingAPI. En V1: el componente sabe
// qué type espera según route name (CommunityLandingPageSectorial,
// etc.). El endpoint acepta ?type= para desambiguar si fuera
// necesario, pero en V1 los slugs no colisionan entre types.

export const loadData = (params /*, search */) => async dispatch => {
  const slug = params?.slug;
  if (!slug) {
    dispatch(communityLoadNotFound());
    return;
  }
  dispatch(communityLoadStart());
  try {
    const res = await fetch(`${apiBaseUrl()}/api/communities/${encodeURIComponent(slug)}`, {
      credentials: 'include',
    });
    if (res.status === 404) {
      dispatch(communityLoadNotFound());
      return;
    }
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      dispatch(
        communityLoadFailed(
          storableError(new Error(`community HTTP ${res.status}: ${txt}`))
        )
      );
      return;
    }
    const payload = await res.json();
    dispatch(
      communityLoadSuccess({
        community: payload.community,
        listings: reviveSdkTypes(payload.listings),
      })
    );
  } catch (err) {
    dispatch(communityLoadFailed(storableError(err)));
  }
};

// ====== selectors ======

export const selectCommunity = state => state.CommunityLandingPage?.community;
export const selectCommunityListings = state => state.CommunityLandingPage?.listings;
export const selectCommunityLoading = state => !!state.CommunityLandingPage?.inProgress;
export const selectCommunityNotFound = state => !!state.CommunityLandingPage?.notFound;
export const selectCommunityError = state => state.CommunityLandingPage?.error;
