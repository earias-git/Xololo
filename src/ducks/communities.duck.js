// XOLOLO 2026-11-18 — ADR-006 PR-3: duck de comunidades (frontend).
//
// Estado del seller sobre sus comunidades + thunks para join/leave.
// NO carga la landing /comunidad/:slug por aquí — eso será un
// loadData propio del CommunityLandingPage en PR-6.
//
// Shape:
//   {
//     myCommunities: [{id, type, name, ...}] | null,
//     loading: boolean,
//     mutating: null | {id, action},
//     error: null | string,
//     lastSyncStats: null | {updated, failed, total},
//   }

import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';

import { apiBaseUrl } from '../util/api';

// ====== thunks ======

const fetchJson = async (url, opts = {}) => {
  const r = await fetch(`${apiBaseUrl()}${url}`, {
    credentials: 'include',
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  });
  const text = await r.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (_) {
    data = { raw: text };
  }
  if (!r.ok) {
    const err = new Error(data?.error || `HTTP ${r.status}`);
    err.status = r.status;
    err.payload = data;
    throw err;
  }
  return data;
};

export const fetchMyCommunities = createAsyncThunk(
  'communities/fetchMine',
  async (_, { rejectWithValue }) => {
    try {
      const data = await fetchJson('/api/me/communities');
      return data.communities || [];
    } catch (e) {
      return rejectWithValue({ error: e.message, status: e.status });
    }
  }
);

export const joinCommunity = createAsyncThunk(
  'communities/join',
  async ({ slug, type }, { rejectWithValue }) => {
    try {
      const qs = type ? `?type=${encodeURIComponent(type)}` : '';
      const data = await fetchJson(`/api/communities/${slug}/join${qs}`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      return data;
    } catch (e) {
      return rejectWithValue({ error: e.message, status: e.status, payload: e.payload });
    }
  }
);

export const leaveCommunity = createAsyncThunk(
  'communities/leave',
  async ({ slug, type }, { rejectWithValue }) => {
    try {
      const qs = type ? `?type=${encodeURIComponent(type)}` : '';
      const data = await fetchJson(`/api/communities/${slug}/leave${qs}`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      return data;
    } catch (e) {
      return rejectWithValue({ error: e.message, status: e.status, payload: e.payload });
    }
  }
);

// ====== slice ======

const initialState = {
  myCommunities: null,
  loading: false,
  mutating: null,
  error: null,
  lastSyncStats: null,
};

const communitiesSlice = createSlice({
  name: 'communities',
  initialState,
  reducers: {
    clearCommunitiesError: state => {
      state.error = null;
    },
  },
  extraReducers: builder => {
    builder
      // fetchMyCommunities
      .addCase(fetchMyCommunities.pending, state => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchMyCommunities.fulfilled, (state, action) => {
        state.loading = false;
        state.myCommunities = action.payload;
      })
      .addCase(fetchMyCommunities.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload?.error || 'fetch_failed';
      })
      // joinCommunity
      .addCase(joinCommunity.pending, (state, action) => {
        state.mutating = { id: action.meta.arg.slug, action: 'join' };
        state.error = null;
      })
      .addCase(joinCommunity.fulfilled, (state, action) => {
        state.mutating = null;
        state.lastSyncStats = action.payload?.stats || null;
        // Agrega la comunidad a myCommunities si no estaba.
        const added = action.payload?.community;
        if (added && Array.isArray(state.myCommunities)) {
          if (!state.myCommunities.find(c => c.id === added.id && c.type === added.type)) {
            state.myCommunities.push(added);
          }
        }
      })
      .addCase(joinCommunity.rejected, (state, action) => {
        state.mutating = null;
        state.error = action.payload?.error || 'join_failed';
      })
      // leaveCommunity
      .addCase(leaveCommunity.pending, (state, action) => {
        state.mutating = { id: action.meta.arg.slug, action: 'leave' };
        state.error = null;
      })
      .addCase(leaveCommunity.fulfilled, (state, action) => {
        state.mutating = null;
        state.lastSyncStats = action.payload?.stats || null;
        const removed = action.payload?.community;
        if (removed && Array.isArray(state.myCommunities)) {
          state.myCommunities = state.myCommunities.filter(
            c => !(c.id === removed.id && c.type === removed.type)
          );
        }
      })
      .addCase(leaveCommunity.rejected, (state, action) => {
        state.mutating = null;
        state.error = action.payload?.error || 'leave_failed';
      });
  },
});

export const { clearCommunitiesError } = communitiesSlice.actions;
export default communitiesSlice.reducer;

// ====== selectors ======
export const selectMyCommunities = state => state.communities?.myCommunities;
export const selectCommunitiesLoading = state => !!state.communities?.loading;
export const selectCommunitiesMutating = state => state.communities?.mutating;
export const selectCommunitiesError = state => state.communities?.error;
export const selectLastSyncStats = state => state.communities?.lastSyncStats;
