import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import { storableError } from '../../util/errors';
import { parse, getValidInboxSort } from '../../util/urlHelpers';
import { getSupportedProcessesInfo } from '../../transactions/transaction';
import { addMarketplaceEntities } from '../../ducks/marketplaceData.duck';
import { apiBaseUrl, typeHandlers } from '../../util/api';
import { transit } from '../../util/sdkLoader';
import { getCurrentWorkspace } from '../../util/xololoTeam';

const INBOX_PAGE_SIZE = 10;

// XOLOLO · E9 fase 3: cuando el colaborador opera como el Negocio, el
// inbox se carga via /api/inbox-transactions (scoped al admin por
// requireSellerContext). El tab "sales" filtra por providerId del admin;
// "orders" por customerId del admin. Response shape igual al del SDK.
const fetchInboxAsWorkspace = async (tab, apiQueryParams) => {
  const role = tab === 'sales' ? 'provider' : 'customer';
  // El server ya aplica providerId/customerId del admin — removemos del
  // body cualquier filtro conflictivo. El 'only' tampoco se envía porque
  // Integration SDK no lo soporta de la misma forma.
  const { only: _only, ...safeParams } = apiQueryParams;
  const res = await fetch(`${apiBaseUrl()}/api/inbox-transactions`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role, ...safeParams }),
  });
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    const err = new Error(errData?.error || 'inbox_fetch_failed');
    err.status = res.status;
    throw err;
  }
  // transit+json → instancias reales del SDK (Money, UUID, etc).
  const text = await res.text();
  const parsed = transit.read(text, { typeHandlers });
  return { data: parsed };
};

// ================ Helper functions ================ //

const entityRefs = entities =>
  entities.map(entity => ({
    id: entity.id,
    type: entity.type,
  }));

// ================ Slice ================ //

const inboxPageSlice = createSlice({
  name: 'InboxPage',
  initialState: {
    fetchInProgress: false,
    fetchOrdersOrSalesError: null,
    pagination: null,
    transactionRefs: [],
  },
  reducers: {},
  extraReducers: builder => {
    builder
      .addCase(loadDataThunk.pending, state => {
        state.fetchInProgress = true;
        state.fetchOrdersOrSalesError = null;
      })
      .addCase(loadDataThunk.fulfilled, (state, action) => {
        const transactions = action.payload.data.data;
        state.fetchInProgress = false;
        state.transactionRefs = entityRefs(transactions);
        state.pagination = action.payload.data.meta;
      })
      .addCase(loadDataThunk.rejected, (state, action) => {
        console.error(action.payload || action.error);
        state.fetchInProgress = false;
        state.fetchOrdersOrSalesError = action.payload;
      });
  },
});

export default inboxPageSlice.reducer;

// ================ Load data ================ //

const loadDataPayloadCreator = (
  { params, search },
  { dispatch, getState, rejectWithValue, extra: sdk }
) => {
  const { tab } = params;

  const onlyFilterValues = {
    orders: 'order',
    sales: 'sale',
  };

  const onlyFilter = onlyFilterValues[tab];
  if (!onlyFilter) {
    return Promise.reject(new Error(`Invalid tab for InboxPage: ${tab}`));
  }

  const { page = 1, sort } = parse(search);
  const processNames = getSupportedProcessesInfo().map(p => p.name);

  const apiQueryParams = {
    only: onlyFilter,
    processNames,
    include: [
      'listing',
      'provider',
      'provider.profileImage',
      'customer',
      'customer.profileImage',
      'booking',
    ],
    'fields.transaction': [
      'processName',
      'lastTransition',
      'lastTransitionedAt',
      'transitions',
      'payinTotal',
      'payoutTotal',
      'lineItems',
      // XOLOLO Envíos v2: necesario para computar el status label
      // específico por modo/sub-etapa en getXoloInboxStatusLabel().
      // Sin protectedData el helper no puede leer xololoShipping.mode
      // y siempre cae al label default "Esperando la entrega".
      'protectedData',
      'metadata',
    ],
    'fields.listing': ['title', 'availabilityPlan', 'publicData.listingType'],
    'fields.user': ['profile.displayName', 'profile.abbreviatedName', 'deleted', 'banned'],
    'fields.image': ['variants.square-small', 'variants.square-small2x'],
    page,
    perPage: INBOX_PAGE_SIZE,
    ...getValidInboxSort(sort),
  };

  // XOLOLO · E9 fase 3: cuando el user opera como colaborador del
  // Negocio, el inbox se carga via /api/inbox-transactions con el
  // adminId resuelto por requireSellerContext. En modo propio seguimos
  // usando el SDK directo del user logueado.
  const workspace = getCurrentWorkspace(getState().user?.currentUser);
  const fetchPromise = workspace
    ? fetchInboxAsWorkspace(tab, apiQueryParams)
    : sdk.transactions.query(apiQueryParams);

  return fetchPromise
    .then(response => {
      dispatch(addMarketplaceEntities(response));
      return response;
    })
    .catch(e => {
      return rejectWithValue(storableError(e));
    });
};

export const loadDataThunk = createAsyncThunk('InboxPage/loadData', loadDataPayloadCreator);

// Backward compatible wrapper for the thunk
export const loadData = (params, search) => (dispatch, getState, sdk) => {
  return dispatch(loadDataThunk({ params, search }));
};
