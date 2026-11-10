import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';

import { omit } from '../../util/common';
import { types as sdkTypes, createImageVariantConfig } from '../../util/sdkLoader';
import { denormalisedResponseEntities } from '../../util/data';
import {
  getDefaultTimeZoneOnBrowser,
  getStartOf,
  getStartOfWeek,
  monthIdString,
  parseDateFromISO8601,
  stringifyDateToISO8601,
} from '../../util/dates';
import { uniqueBy } from '../../util/generators';
import { storableError } from '../../util/errors';
import * as log from '../../util/log';
import { parse } from '../../util/urlHelpers';
import { isUserAuthorized } from '../../util/userHelpers';
import { isBookingProcessAlias } from '../../transactions/transaction';

import { addMarketplaceEntities } from '../../ducks/marketplaceData.duck';
import {
  createStripeAccount,
  updateStripeAccount,
  fetchStripeAccount,
} from '../../ducks/stripeConnectAccount.duck';
import { fetchCurrentUser } from '../../ducks/user.duck';

// XOLOLO · E9 fase 2: cuando el usuario opera como colaborador de un
// Negocio (getCurrentWorkspace devuelve un workspace activo), las
// operaciones de listing (create/update/publish/discard/stock) deben
// ejecutarse bajo la identidad del admin via los wrappers
// /api/team/as/listing/*. En modo propio, se usa el SDK normal.
import { getCurrentWorkspace } from '../../util/xololoTeam';
import {
  createDraftAs,
  updateListingAs,
  publishDraftAs,
  updateStockAs,
  closeListingAs,
} from '../../util/apiAsWorkspace';
// XOLOLO (variantes · PR 2b): helper para construir siblings consistentes
// con el master. buildSiblingPayload clona lo esencial + aplica override.
import { buildSiblingPayload } from '../../util/variants';

const { UUID, Money } = sdkTypes;

// Create array of N items where indexing starts from 1
const getArrayOfNItems = n =>
  Array(n)
    .fill()
    .map((v, i) => i + 1)
    .slice(1);

// Return an array of image ids
const imageIds = images => {
  // For newly uploaded image the UUID can be found from "img.imageId"
  // and for existing listing images the id is "img.id"
  return images ? images.map(img => img.imageId || img.id) : null;
};

// After listing creation & update, we want to make sure that uploadedImages state is cleaned
const updateUploadedImagesState = (state, payload) => {
  const { uploadedImages, uploadedImagesOrder } = state;

  // Images attached to listing entity
  const attachedImages = payload?.data?.relationships?.images?.data || [];
  const attachedImageUUIDStrings = attachedImages.map(img => img.id.uuid);

  // Uploaded images (which are propably not yet attached to listing)
  const unattachedImages = Object.values(state.uploadedImages);
  const duplicateImageEntities = unattachedImages.filter(unattachedImg =>
    attachedImageUUIDStrings.includes(unattachedImg.imageId?.uuid)
  );
  return duplicateImageEntities.length > 0
    ? {
        uploadedImages: {},
        uploadedImagesOrder: [],
      }
    : {
        uploadedImages,
        uploadedImagesOrder,
      };
};

const getImageVariantInfo = listingImageConfig => {
  const { aspectWidth = 1, aspectHeight = 1, variantPrefix = 'listing-card' } = listingImageConfig;
  const aspectRatio = aspectHeight / aspectWidth;
  const fieldsImage = [`variants.${variantPrefix}`, `variants.${variantPrefix}-2x`];

  return {
    fieldsImage,
    imageVariants: {
      ...createImageVariantConfig(`${variantPrefix}`, 400, aspectRatio),
      ...createImageVariantConfig(`${variantPrefix}-2x`, 800, aspectRatio),
    },
  };
};

const sortExceptionsByStartTime = (a, b) => {
  return a.attributes.start.getTime() - b.attributes.start.getTime();
};

// ================ Async Thunks ================ //

//////////////////
// Show Listing //
//////////////////
export const showListingThunk = createAsyncThunk(
  'EditListingPage/showListing',
  ({ actionPayload, config }, { dispatch, rejectWithValue, extra: sdk }) => {
    const imageVariantInfo = getImageVariantInfo(config.layout.listingImage);
    const queryParams = {
      include: ['author', 'images', 'currentStock'],
      'fields.image': imageVariantInfo.fieldsImage,
      ...imageVariantInfo.imageVariants,
    };

    return sdk.ownListings
      .show({ ...actionPayload, ...queryParams })
      .then(response => {
        // EditListingPage fetches new listing data, which also needs to be added to global data
        dispatch(addMarketplaceEntities(response));
        return response;
      })
      .catch(e => {
        return rejectWithValue(storableError(e));
      });
  }
);
// Backward compatible wrappers for the thunks
export const requestShowListing = (actionPayload, config) => (dispatch, getState, sdk) => {
  return dispatch(showListingThunk({ actionPayload, config })).unwrap();
};

///////////////
// Set Stock //
///////////////
export const setStockThunk = createAsyncThunk(
  'EditListingPage/setStock',
  ({ listingId, oldTotal, newTotal }, { dispatch, getState, rejectWithValue, extra: sdk }) => {
    // XOLOLO · E9 fase 2: en modo colaborador, el stock se actualiza via
    // el wrapper /api/team/as/listing/update-stock bajo la identidad del
    // admin. Si no hay workspace activo, SDK directo.
    const workspace = getCurrentWorkspace(getState().user?.currentUser);
    const idUuid = listingId?.uuid || listingId;
    const fetchPromise = workspace
      ? updateStockAs(workspace.sellerId, idUuid, oldTotal, newTotal)
      : sdk.stock.compareAndSet({ listingId, oldTotal, newTotal }, { expand: true });

    return fetchPromise
      .then(response => {
        // NOTE: compareAndSet returns the stock resource of the listing.
        // We update client app's internal state with these updated API entities.
        dispatch(addMarketplaceEntities(response));
        return response;
      })
      .catch(e => {
        log.error(e, 'update-stock-failed', { listingId, oldTotal, newTotal });
        return rejectWithValue(storableError(e));
      });
  }
);
// Backward compatible wrappers for the thunks
// Set stock if requested among listing update info
export const compareAndSetStock = (listingId, oldTotal, newTotal) => (dispatch, getState, sdk) => {
  return dispatch(setStockThunk({ listingId, oldTotal, newTotal }));
};

// Helper function to make compareAndSetStock call if stock update is needed.
const updateStockOfListingMaybe = (listingId, stockTotals, dispatch) => {
  const { oldTotal, newTotal } = stockTotals || {};
  // Note: newTotal and oldTotal must be given, but oldTotal can be null
  const hasStockTotals = newTotal >= 0 && typeof oldTotal !== 'undefined';

  if (listingId && hasStockTotals) {
    return dispatch(compareAndSetStock(listingId, oldTotal, newTotal));
  }
  return Promise.resolve();
};

//////////////////////////
// Create Listing Draft //
//////////////////////////

// Create listing in draft state
// NOTE: we want to keep it possible to include stock management field to the first wizard form.
// this means that there needs to be a sequence of calls:
// create, set stock, show listing (to get updated currentStock entity)
export const createListingDraftThunk = createAsyncThunk(
  'EditListingPage/createListingDraft',
  ({ data, config }, { dispatch, getState, rejectWithValue, extra: sdk }) => {
    const { stockUpdate, images, ...rest } = data;

    // If images should be saved, create array out of the image UUIDs for the API call
    const imageProperty = typeof images !== 'undefined' ? { images: imageIds(images) } : {};
    const ownListingValues = { ...imageProperty, ...rest };

    const imageVariantInfo = getImageVariantInfo(config.layout.listingImage);
    const queryParams = {
      expand: true,
      include: ['author', 'images', 'currentStock'],
      'fields.image': imageVariantInfo.fieldsImage,
      ...imageVariantInfo.imageVariants,
    };

    // XOLOLO · E9 fase 2: en modo colaborador, el draft se crea bajo el
    // admin via /api/team/as/listing/create-draft (shape SDK-compatible).
    const workspace = getCurrentWorkspace(getState().user?.currentUser);
    const fetchPromise = workspace
      ? createDraftAs(workspace.sellerId, ownListingValues, queryParams)
      : sdk.ownListings.createDraft(ownListingValues, queryParams);

    return fetchPromise
      .then(response => {
        dispatch(addMarketplaceEntities(response));
        const listingId = response.data.data.id;
        // If stockUpdate info is passed through, update stock
        return updateStockOfListingMaybe(listingId, stockUpdate, dispatch).then(() => response);
      })
      .catch(e => {
        log.error(e, 'create-listing-draft-failed', { listingData: data });
        return rejectWithValue(storableError(e));
      });
  }
);
// Backward compatible wrappers for the thunks
export const requestCreateListingDraft = (data, config) => (dispatch, getState, sdk) => {
  return dispatch(createListingDraftThunk({ data, config })).unwrap();
};

////////////////////
// Update Listing //
////////////////////

// Update the given tab of the wizard with the given data. This saves
// the data to the listing, and marks the tab updated so the UI can
// display the state.
// NOTE: what comes to stock management, this follows the same pattern used in create listing call
export const updateListingThunk = createAsyncThunk(
  'EditListingPage/updateListing',
  ({ tab, data, config }, { dispatch, getState, rejectWithValue, extra: sdk }) => {
    const { id, stockUpdate, images, ...rest } = data;

    // If images should be saved, create array out of the image UUIDs for the API call
    const imageProperty = typeof images !== 'undefined' ? { images: imageIds(images) } : {};
    const ownListingUpdateValues = { id, ...imageProperty, ...rest };
    const imageVariantInfo = getImageVariantInfo(config.layout.listingImage);
    const queryParams = {
      expand: true,
      include: ['author', 'images', 'currentStock'],
      'fields.image': imageVariantInfo.fieldsImage,
      ...imageVariantInfo.imageVariants,
    };

    // XOLOLO · E9 fase 2: en modo colaborador, el update va al wrapper
    // /api/team/as/listing/update (identidad admin + shape SDK).
    const workspace = getCurrentWorkspace(getState().user?.currentUser);
    const doUpdate = () => {
      if (workspace) {
        // El helper recibe listingId + patch (sin id interno). Separamos.
        const { id: _omit, ...patchFields } = ownListingUpdateValues;
        return updateListingAs(workspace.sellerId, id.uuid, patchFields, queryParams);
      }
      return sdk.ownListings.update(ownListingUpdateValues, queryParams);
    };

    return updateStockOfListingMaybe(id, stockUpdate, dispatch)
      .then(doUpdate)
      .then(response => {
        const state = getState();
        const existingTimeZone =
          state.marketplaceData.entities.ownListing[id.uuid]?.attributes?.availabilityPlan
            ?.timezone;
        const includedTimeZone = data?.availabilityPlan?.timezone;

        // If time zone has changed, we need to fetch exceptions again
        // since week and month boundaries might have changed.
        if (!!includedTimeZone && includedTimeZone !== existingTimeZone) {
          const searchString = '';
          const firstDayOfWeek = config.localization.firstDayOfWeek;
          const listing = response.data.data;
          fetchLoadDataExceptions(dispatch, listing, searchString, firstDayOfWeek);
        }

        dispatch(addMarketplaceEntities(response));
        return { response, tab };
      })
      .then(async result => {
        // XOLOLO (variantes · PR 2b): si el tab guardado es VARIANTS y el
        // master quedó como grupo (isVariantMaster=true + variantsMatrix),
        // sincroniza siblings vía sdk (crear/actualizar/cerrar).
        // Fallos NO abortan el guardado del master — se loguean y seguimos.
        //
        // Guard: solo cuando el patch del panel incluye variantsMatrix en
        // publicData (el panel SIEMPRE lo envía, los updates internos del
        // propio sync NO — así evitamos recursión).
        const isVariantsPanelSubmit =
          tab === 'variants' &&
          data?.publicData &&
          Object.prototype.hasOwnProperty.call(data.publicData, 'variantsMatrix');
        if (isVariantsPanelSubmit) {
          try {
            await dispatch(syncVariantSiblingsThunk({ masterListingId: id, config })).unwrap();
          } catch (e) {
            log.error(e, 'sync-variants-chained-failed', { masterListingId: id });
          }
        }

        // XOLOLO (variantes · PR 5): si el tab guardado es un tab de
        // campos compartidos (TEXT, PHOTOS, STYLE, ATTRIBUTES) y el
        // listing es master de un grupo, replica esos campos a los
        // siblings. El thunk mismo verifica si el listing es master
        // (short-circuit si no), así que correrlo para TODO listing
        // que cae acá es barato.
        //
        // Guard anti-recursión: el replicate aplica patches a los
        // siblings; esos siblings tienen isVariantMaster=false, así que
        // el chain interno short-circuita con skipped:'not_master'.
        if (REPLICABLE_TABS.has(tab)) {
          try {
            await dispatch(
              replicateMasterSharedFieldsThunk({ masterListingId: id, tab })
            ).unwrap();
          } catch (e) {
            log.error(e, 'replicate-shared-fields-chained-failed', { masterListingId: id, tab });
          }
        }
        return result;
      })
      .catch(e => {
        log.error(e, 'update-listing-failed', { listingData: data });
        return rejectWithValue(storableError(e));
      });
  }
);
// Backward compatible wrappers for the thunks
export const requestUpdateListing = (tab, data, config) => (dispatch, getState, sdk) => {
  return dispatch(updateListingThunk({ tab, data, config }))
    .unwrap()
    .then(({ response, tab }) => {
      return response;
    });
};

/////////////////////
// Publish Listing //
/////////////////////

const publishListingPayloadCreator = (
  { listingId },
  { dispatch, getState, rejectWithValue, extra: sdk }
) => {
  // XOLOLO · E9 fase 2: en modo colaborador, publicar el draft va al
  // wrapper /api/team/as/listing/publish-draft.
  const workspace = getCurrentWorkspace(getState().user?.currentUser);
  const idUuid = listingId?.uuid || listingId;
  const fetchPromise = workspace
    ? publishDraftAs(workspace.sellerId, idUuid, { include: ['author', 'images', 'currentStock'] })
    : sdk.ownListings.publishDraft({ id: listingId }, { expand: true });
  return fetchPromise
    .then(response => {
      // Add the created listing to the marketplace data
      dispatch(addMarketplaceEntities(response));
      return response;
    })
    .catch(e => {
      return rejectWithValue(storableError(e));
    });
};

export const publishListingThunk = createAsyncThunk(
  'EditListingPage/publishListing',
  publishListingPayloadCreator
);
// Backward compatible wrappers for the thunks
export const requestPublishListingDraft = listingId => (dispatch, getState, sdk) => {
  return dispatch(publishListingThunk({ listingId })).unwrap();
};

//////////////////////////////////////////////////////////////////////
// XOLOLO (variantes · PR 2b) — Sync de siblings del grupo de variantes
//////////////////////////////////////////////////////////////////////
//
// Lee el master en Redux state (ownListing entity) y reconcilia los
// listings hermanos vs la publicData.variantsMatrix staging:
//   - Row 0 = master (sus variantValues). Ajusta SU stock + priceOverride
//     en el propio master.
//   - Rows 1..N → siblings. Match por variantValues a los siblings
//     existentes del grupo (query por pub_variantGroupId).
//     · Existe → update stock + priceOverride (si cambió).
//     · No existe → createDraft + publishDraft + setStock.
//   - Siblings existentes NO presentes en el matrix → close (reversible).
//
// Sequential por simplicidad y para evitar rate limits. Si falla un
// sibling, se loguea y continúa — el seller puede re-guardar el tab
// para reintentar (idempotente: no duplica siblings).

const rowKey = (axes, variantValues) =>
  axes.map(ax => variantValues?.[ax] ?? '').join('||');

// Convierte un número (en unidades, p.ej. 350 pesos) a Money subunits.
const toMoneyFromNumber = (n, currency) => {
  if (n === null || n === undefined || n === '') return null;
  const num = Number(n);
  if (!Number.isFinite(num) || num < 0) return null;
  return new Money(Math.round(num * 100), currency);
};

const moneyEquals = (a, b) => {
  if (!a || !b) return false;
  return a.amount === b.amount && a.currency === b.currency;
};

export const syncVariantSiblingsThunk = createAsyncThunk(
  'EditListingPage/syncVariantSiblings',
  async ({ masterListingId, config }, { dispatch, getState, rejectWithValue, extra: sdk }) => {
    const state = getState();
    const master = state.marketplaceData.entities.ownListing[masterListingId?.uuid];
    if (!master) {
      log.error(new Error('sync-variants: master not in state'), 'sync-variants-no-master', {
        masterListingId,
      });
      return rejectWithValue(storableError(new Error('master_not_found')));
    }

    const pd = master.attributes?.publicData || {};
    if (pd.isVariantMaster !== true || !pd.variantGroupId) {
      // El listing no es master de un grupo — nada que sincronizar.
      return { synced: 0, skipped: 'not_master' };
    }
    const axes = Array.isArray(pd.variantAxes) ? pd.variantAxes : [];
    const matrix = Array.isArray(pd.variantsMatrix) ? pd.variantsMatrix : [];
    if (axes.length === 0 || matrix.length === 0) {
      return { synced: 0, skipped: 'empty_matrix' };
    }

    const workspace = getCurrentWorkspace(state.user?.currentUser);
    const currency = master.attributes?.price?.currency || config.currency;
    const imageIdsFromMaster = (master.relationships?.images?.data || []).map(i => i.id);

    const imageVariantInfo = getImageVariantInfo(config.layout.listingImage);
    const queryParams = {
      expand: true,
      include: ['author', 'images', 'currentStock'],
      'fields.image': imageVariantInfo.fieldsImage,
      ...imageVariantInfo.imageVariants,
    };

    // ---- 1. Query hermanos existentes del grupo ----
    //
    // XOLOLO (PR 2c): Sharetribe NO filtra por pub_variantGroupId
    // (el campo no está registrado como listing field en Console), así
    // que la query devuelve TODO el marketplace. Filtramos cliente por
    // publicData.variantGroupId. Sin esto, Redux se llena de listings
    // ajenos y el iterador de rows nunca matchea "existente" → intenta
    // crear duplicados.
    let existingSiblings = [];
    try {
      // XOLOLO 2026-11-10: incluir currentStock (y author/images) es
      // obligatorio — si no viene currentStock, el setStock de más
      // abajo pasa oldTotal:null a compareAndSet y Sharetribe responde
      // 409 (el stock YA existe en el sibling). Resultado: el stock
      // nunca se actualiza y el buyer ve stock "fantasma".
      const res = await sdk.ownListings.query({
        pub_variantGroupId: pd.variantGroupId,
        perPage: 100,
        ...queryParams,
      });
      const all = res.data?.data || [];
      const inGroup = all.filter(
        l => l.attributes?.publicData?.variantGroupId === pd.variantGroupId
      );
      existingSiblings = inGroup.filter(l => l.id?.uuid !== masterListingId.uuid);
      // Dispatch SOLO los del grupo para no inyectar basura en Redux.
      const filteredRes = {
        ...res,
        data: { ...res.data, data: inGroup, included: res.data?.included || [] },
      };
      dispatch(addMarketplaceEntities(filteredRes));
      // eslint-disable-next-line no-console
      console.log('[variants-sync] query result', {
        groupId: pd.variantGroupId,
        sharetribeReturned: all.length,
        inGroup: inGroup.length,
        existingSiblings: existingSiblings.length,
      });
    } catch (e) {
      log.error(e, 'sync-variants-query-failed', { groupId: pd.variantGroupId });
      // eslint-disable-next-line no-console
      console.error('[variants-sync] query failed', e);
      return rejectWithValue(storableError(e));
    }

    // ---- 2. Localiza la fila del master (por variantValues) ----
    //
    // XOLOLO 2026-11-10: el master NO es por convención row[0]. Su
    // combinación (variantValues) viene del paso Atributos. Buscamos
    // en la matrix la fila que matchee esos valores y la usamos para
    // ajustar stock/precio del master. Todas las demás filas son
    // candidatas a siblings.
    const masterKey = rowKey(axes, pd.variantValues);
    const masterRowIdx = matrix.findIndex(
      r => rowKey(axes, r?.variantValues) === masterKey
    );
    const masterRow = masterRowIdx >= 0 ? matrix[masterRowIdx] : null;
    const masterStock = master.currentStock?.attributes?.quantity;
    const masterPrice = master.attributes?.price;

    let masterUpdated = 0;
    if (masterRow) {
      // Stock
      if (typeof masterRow.stock === 'number' && masterRow.stock !== masterStock) {
        try {
          await dispatch(
            setStockThunk({
              listingId: masterListingId,
              oldTotal: typeof masterStock === 'number' ? masterStock : null,
              newTotal: masterRow.stock,
            })
          ).unwrap();
          masterUpdated += 1;
        } catch (e) {
          log.error(e, 'sync-variants-master-stock-failed', { masterListingId });
        }
      }
      // Precio
      const newPrice = toMoneyFromNumber(masterRow.priceOverride, currency);
      if (newPrice && !moneyEquals(newPrice, masterPrice)) {
        try {
          await dispatch(
            updateListingThunk({ tab: 'variants', data: { id: masterListingId, price: newPrice }, config })
          ).unwrap();
          masterUpdated += 1;
        } catch (e) {
          log.error(e, 'sync-variants-master-price-failed', { masterListingId });
        }
      }
    } else {
      // El master no tiene fila propia en la matrix → el seller no
      // incluyó la combinación del producto maestro. Loguear pero
      // no fallar.
      // eslint-disable-next-line no-console
      console.warn('[variants-sync] master combination not in matrix', {
        masterValues: pd.variantValues,
      });
    }

    // ---- 3. Todas las demás filas → siblings ----
    const matchedExistingIds = new Set();
    let siblingsCreated = 0;
    let siblingsUpdated = 0;
    let siblingsFailed = 0;

    for (let i = 0; i < matrix.length; i++) {
      if (i === masterRowIdx) continue; // fila del master, ya tratada
      const row = matrix[i];
      const key = rowKey(axes, row.variantValues);
      const existing = existingSiblings.find(l => {
        const vv = l.attributes?.publicData?.variantValues;
        return rowKey(axes, vv) === key;
      });

      try {
        if (existing) {
          // Match → update stock + precio si cambiaron.
          matchedExistingIds.add(existing.id.uuid);
          const curStock = existing.currentStock?.attributes?.quantity;
          if (typeof row.stock === 'number' && row.stock !== curStock) {
            await dispatch(
              setStockThunk({
                listingId: existing.id,
                oldTotal: typeof curStock === 'number' ? curStock : null,
                newTotal: row.stock,
              })
            ).unwrap();
          }
          const newPrice = toMoneyFromNumber(row.priceOverride, currency);
          if (newPrice && !moneyEquals(newPrice, existing.attributes?.price)) {
            await dispatch(
              updateListingThunk({
                tab: 'variants',
                data: { id: existing.id, price: newPrice },
                config,
              })
            ).unwrap();
          }
          siblingsUpdated += 1;
        } else {
          // Nuevo sibling → createDraft + publish + setStock.
          const payload = buildSiblingPayload(master, {
            variantValues: row.variantValues,
            priceOverride: toMoneyFromNumber(row.priceOverride, currency),
          });
          if (imageIdsFromMaster.length > 0) {
            payload.images = imageIdsFromMaster;
          }

          const createRes = workspace
            ? await createDraftAs(workspace.sellerId, payload, queryParams)
            : await sdk.ownListings.createDraft(payload, queryParams);
          dispatch(addMarketplaceEntities(createRes));
          const newListingId = createRes.data.data.id;

          const pubRes = workspace
            ? await publishDraftAs(workspace.sellerId, newListingId.uuid, queryParams)
            : await sdk.ownListings.publishDraft({ id: newListingId }, { expand: true });
          dispatch(addMarketplaceEntities(pubRes));

          if (typeof row.stock === 'number' && row.stock > 0) {
            await dispatch(
              setStockThunk({ listingId: newListingId, oldTotal: null, newTotal: row.stock })
            ).unwrap();
          }
          siblingsCreated += 1;
        }
      } catch (e) {
        log.error(e, 'sync-variants-sibling-failed', { row, index: i });
        // eslint-disable-next-line no-console
        console.error('[variants-sync] sibling failed', {
          index: i,
          variantValues: row.variantValues,
          error: e?.message,
          data: e?.data,
          statusText: e?.statusText,
        });
        siblingsFailed += 1;
      }
    }

    // ---- 4. Siblings existentes NO en el matrix → close ----
    //
    // XOLOLO (PR 2c): doble-seguridad — SOLO cerrar listings cuyo
    // publicData.variantGroupId === el del master Y isVariantMaster !== true.
    // Esto previene que un bug futuro (ej. filtro upstream roto) cierre
    // listings ajenos. Un sibling legítimo cumple ambas condiciones.
    let siblingsClosed = 0;
    for (const existing of existingSiblings) {
      if (matchedExistingIds.has(existing.id.uuid)) continue;
      const epd = existing.attributes?.publicData || {};
      if (epd.variantGroupId !== pd.variantGroupId || epd.isVariantMaster === true) {
        // eslint-disable-next-line no-console
        console.warn('[variants-sync] REFUSE to close non-sibling', {
          listingId: existing.id?.uuid,
          hasGroupId: !!epd.variantGroupId,
          isMaster: epd.isVariantMaster,
        });
        continue;
      }
      try {
        if (workspace) {
          const res = await closeListingAs(workspace.sellerId, existing.id.uuid, queryParams);
          dispatch(addMarketplaceEntities(res));
        } else {
          const res = await sdk.ownListings.close({ id: existing.id }, { expand: true });
          dispatch(addMarketplaceEntities(res));
        }
        siblingsClosed += 1;
      } catch (e) {
        log.error(e, 'sync-variants-close-failed', { listingId: existing.id?.uuid });
      }
    }

    const result = {
      synced: siblingsCreated + siblingsUpdated,
      masterUpdated,
      siblingsCreated,
      siblingsUpdated,
      siblingsClosed,
      siblingsFailed,
    };
    // eslint-disable-next-line no-console
    console.log('[variants-sync] done', result);
    return result;
  }
);

// Backward compatible wrapper.
export const requestSyncVariantSiblings = (masterListingId, config) => dispatch => {
  return dispatch(syncVariantSiblingsThunk({ masterListingId, config })).unwrap();
};

// XOLOLO (variantes · PR 5) — Lee los siblings del grupo (ownListings,
// para incluir drafts y cerrados que no salen en sdk.listings.query).
// Usado por el VariantsBreadcrumb del wizard para armar quick-nav.
export const fetchOwnVariantSiblingsThunk = createAsyncThunk(
  'EditListingPage/fetchOwnVariantSiblings',
  ({ groupId }, { dispatch, rejectWithValue, extra: sdk }) => {
    if (!groupId) return Promise.resolve([]);
    return sdk.ownListings
      .query({
        pub_variantGroupId: groupId,
        perPage: 100,
      })
      .then(res => {
        // XOLOLO (PR 2c): filtro cliente — Sharetribe ignora
        // pub_variantGroupId. Devuelve TODOS los ownListings sin el
        // filtro aplicado.
        const all = res?.data?.data || [];
        return all.filter(
          l => l.attributes?.publicData?.variantGroupId === groupId
        );
      })
      .catch(e => rejectWithValue(storableError(e)));
  }
);

export const fetchOwnVariantSiblings = groupId => dispatch => {
  return dispatch(fetchOwnVariantSiblingsThunk({ groupId })).unwrap();
};

////////////////////////////////////////////////////////////////////////
// XOLOLO (variantes · PR 5) — Replicar campos compartidos del master
//                             a los siblings después de guardar.
////////////////////////////////////////////////////////////////////////
//
// Cuando el seller edita el master y guarda un tab de campos
// COMPARTIDOS (TEXT, PHOTOS, STYLE, ATTRIBUTES), replicamos el cambio
// a todos los hermanos del grupo:
//   - TEXT: title + description
//   - PHOTOS / STYLE: images
//   - ATTRIBUTES: publicData.subcategory + attributes + event
//
// Stock, precio y variantValues NO se replican — son por-variante.
//
// Fallos NO abortan: se loguean, el user puede re-guardar para reintentar.
// Idempotente: aplicar el mismo patch dos veces no causa cambio.

const REPLICABLE_TABS = new Set(['text', 'photos', 'style', 'attributes']);

const buildReplicatePatch = (master, tab) => {
  const attrs = master.attributes || {};
  const pd = attrs.publicData || {};
  const patch = {};

  if (tab === 'text') {
    if (attrs.title !== undefined) patch.title = attrs.title;
    if (attrs.description !== undefined) patch.description = attrs.description;
  }
  if (tab === 'photos' || tab === 'style') {
    const imageIds = (master.relationships?.images?.data || []).map(i => i.id);
    if (imageIds.length > 0) patch.images = imageIds;
  }
  if (tab === 'attributes') {
    const inner = {};
    if (pd.subcategory !== undefined) inner.subcategory = pd.subcategory;
    if (pd.attributes !== undefined) inner.attributes = pd.attributes;
    if (pd.attributesVersion !== undefined) inner.attributesVersion = pd.attributesVersion;
    if (pd.event !== undefined) inner.event = pd.event;
    if (Object.keys(inner).length > 0) patch.publicData = inner;
  }
  return patch;
};

export const replicateMasterSharedFieldsThunk = createAsyncThunk(
  'EditListingPage/replicateMasterSharedFields',
  async ({ masterListingId, tab }, { dispatch, getState, rejectWithValue, extra: sdk }) => {
    if (!REPLICABLE_TABS.has(tab)) return { skipped: 'tab_not_replicable' };
    const state = getState();
    const master = state.marketplaceData.entities.ownListing[masterListingId?.uuid];
    if (!master || master.attributes?.publicData?.isVariantMaster !== true) {
      return { skipped: 'not_master' };
    }
    const groupId = master.attributes?.publicData?.variantGroupId;
    if (!groupId) return { skipped: 'no_group' };

    const patch = buildReplicatePatch(master, tab);
    if (Object.keys(patch).length === 0) return { skipped: 'empty_patch' };

    const workspace = getCurrentWorkspace(state.user?.currentUser);

    // Query siblings (excluyendo al master).
    let siblings = [];
    try {
      const res = await sdk.ownListings.query({ pub_variantGroupId: groupId, perPage: 100 });
      siblings = (res.data?.data || []).filter(l => l.id?.uuid !== masterListingId.uuid);
    } catch (e) {
      log.error(e, 'replicate-query-failed', { groupId });
      return rejectWithValue(storableError(e));
    }

    // Aplica el patch a cada sibling. Sequential + fail-soft.
    let replicated = 0;
    let failed = 0;
    for (const sib of siblings) {
      const sibId = sib.id;
      try {
        if (workspace) {
          await updateListingAs(workspace.sellerId, sibId.uuid, patch, {});
        } else {
          await sdk.ownListings.update({ id: sibId, ...patch }, { expand: true });
        }
        replicated += 1;
      } catch (e) {
        log.error(e, 'replicate-sibling-failed', { sibling: sibId?.uuid, tab });
        failed += 1;
      }
    }
    return { replicated, failed, tab };
  }
);

export const replicateMasterSharedFields = (masterListingId, tab) => dispatch => {
  return dispatch(replicateMasterSharedFieldsThunk({ masterListingId, tab })).unwrap();
};

//////////////////
// Upload Image //
//////////////////

// Images return imageId which we need to map with previously generated temporary id
export const uploadImageThunk = createAsyncThunk(
  'EditListingPage/uploadImage',
  ({ actionPayload, listingImageConfig }, { rejectWithValue, extra: sdk }) => {
    const imageVariantInfo = getImageVariantInfo(listingImageConfig);
    const queryParams = {
      expand: true,
      'fields.image': imageVariantInfo.fieldsImage,
      ...imageVariantInfo.imageVariants,
    };

    return sdk.images
      .upload({ image: actionPayload.file }, queryParams)
      .then(resp => {
        const img = resp.data.data;
        // Uploaded image has an existing id that refers to file
        // The UUID was created as a consequence of this upload call - it's saved to imageId property
        return {
          data: { ...img, id: actionPayload.id, imageId: img.id, file: actionPayload.file },
        };
      })
      .catch(e => {
        return rejectWithValue({ id: actionPayload.id, error: storableError(e) });
      });
  }
);
// Backward compatible wrappers for the thunks
export const requestImageUpload = (actionPayload, listingImageConfig) => (
  dispatch,
  getState,
  sdk
) => {
  return dispatch(uploadImageThunk({ actionPayload, listingImageConfig })).unwrap();
};

///////////////////////////////
// Add AvailabilityException //
///////////////////////////////
const addAvailabilityExceptionPayloadCreator = ({ params }, { rejectWithValue, extra: sdk }) => {
  return sdk.availabilityExceptions
    .create(params, { expand: true })
    .then(response => {
      const availabilityException = response.data.data;
      return { data: availabilityException };
    })
    .catch(e => {
      return rejectWithValue({ error: storableError(e) });
    });
};

export const addAvailabilityExceptionThunk = createAsyncThunk(
  'EditListingPage/addAvailabilityException',
  addAvailabilityExceptionPayloadCreator
);
// Backward compatible wrappers for the thunks
export const requestAddAvailabilityException = params => (dispatch, getState, sdk) => {
  return dispatch(addAvailabilityExceptionThunk({ params })).unwrap();
};

//////////////////////////////////
// Delete AvailabilityException //
//////////////////////////////////
const deleteAvailabilityExceptionPayloadCreator = ({ params }, { rejectWithValue, extra: sdk }) => {
  return sdk.availabilityExceptions
    .delete(params, { expand: true })
    .then(response => {
      const availabilityException = response.data.data;
      return { data: availabilityException };
    })
    .catch(e => {
      return rejectWithValue({ error: storableError(e) });
    });
};

export const deleteAvailabilityExceptionThunk = createAsyncThunk(
  'EditListingPage/deleteAvailabilityException',
  deleteAvailabilityExceptionPayloadCreator
);
// Backward compatible wrappers for the thunks
export const requestDeleteAvailabilityException = params => (dispatch, getState, sdk) => {
  return dispatch(deleteAvailabilityExceptionThunk({ params })).unwrap();
};

//////////////////////////////////
// Fetch AvailabilityExceptions //
//////////////////////////////////
const fetchAvailabilityExceptionsPayloadCreator = (
  { params },
  { dispatch, rejectWithValue, extra: sdk }
) => {
  const { listingId, start, end, timeZone, page, isWeekly } = params;
  const fetchParams = { listingId, start, end };
  const timeUnitIdProp = isWeekly
    ? { weekStartId: stringifyDateToISO8601(start) }
    : { monthId: monthIdString(start, timeZone) };

  return sdk.availabilityExceptions
    .query(fetchParams)
    .then(response => {
      const availabilityExceptions = denormalisedResponseEntities(response);

      // Fetch potential extra exceptions pagination pages per month.
      const totalPages = response.data.meta.totalPages;
      if (totalPages > 1 && !page) {
        const extraPages = getArrayOfNItems(totalPages);

        Promise.all(
          extraPages.map(page => {
            return sdk.availabilityExceptions.query({ ...fetchParams, page });
          })
        ).then(responses => {
          const denormalizedFlatResults = (all, r) => all.concat(denormalisedResponseEntities(r));
          const exceptions = responses.reduce(denormalizedFlatResults, []);
          dispatch(
            fetchExtraAvailabilityExceptionsThunk.fulfilled({
              data: { ...timeUnitIdProp, exceptions },
            })
          );
        });
      }

      return {
        ...timeUnitIdProp,
        exceptions: availabilityExceptions,
      };
    })
    .catch(e => {
      return rejectWithValue({ ...timeUnitIdProp, error: storableError(e) });
    });
};

export const fetchAvailabilityExceptionsThunk = createAsyncThunk(
  'EditListingPage/fetchAvailabilityExceptions',
  fetchAvailabilityExceptionsPayloadCreator
);
// Backward compatible wrappers for the thunks
export const requestFetchAvailabilityExceptions = params => (dispatch, getState, sdk) => {
  return dispatch(fetchAvailabilityExceptionsThunk({ params })).unwrap();
};

export const fetchExtraAvailabilityExceptionsThunk = createAsyncThunk(
  'EditListingPage/fetchExtraAvailabilityExceptions',
  ({ data }) => data
);

/////////////////////////
// Save Payout Details //
/////////////////////////
const savePayoutDetailsPayloadCreator = (
  { values, isUpdateCall },
  { dispatch, rejectWithValue }
) => {
  const upsertThunk = isUpdateCall ? updateStripeAccount : createStripeAccount;

  return dispatch(upsertThunk(values, { expand: true }))
    .then(response => {
      return response;
    })
    .catch(() => {
      return rejectWithValue();
    });
};

export const savePayoutDetailsThunk = createAsyncThunk(
  'EditListingPage/savePayoutDetails',
  savePayoutDetailsPayloadCreator
);
// Backward compatible wrappers for the thunks
export const savePayoutDetails = (values, isUpdateCall) => dispatch => {
  return dispatch(savePayoutDetailsThunk({ values, isUpdateCall })).unwrap();
};

////////////////////////////////
// Fetch Load Data Exceptions //
////////////////////////////////

// Helper function for loadData call.
const fetchLoadDataExceptions = (dispatch, listing, search, firstDayOfWeek) => {
  const hasWindow = typeof window !== 'undefined';
  // Listing could be ownListing entity too, so we just check if attributes key exists
  const hasTimeZone = listing?.attributes?.availabilityPlan?.timezone;

  // Fetch time-zones on client side only.
  // Note: listing needs to have time zone set!
  if (hasWindow && listing.id && hasTimeZone) {
    const listingId = listing.id;
    // If the listing doesn't have availabilityPlan yet
    // use the defaul timezone
    const timezone = listing.attributes.availabilityPlan?.timezone || getDefaultTimeZoneOnBrowser();
    const todayInListingsTZ = getStartOf(new Date(), 'day', timezone);

    const locationSearch = parse(search);
    const selectedDate = locationSearch?.d
      ? parseDateFromISO8601(locationSearch.d, timezone)
      : todayInListingsTZ;
    const startOfWeek = getStartOfWeek(selectedDate, timezone, firstDayOfWeek);
    const prevWeek = getStartOf(startOfWeek, 'day', timezone, -7, 'days');
    const nextWeek = getStartOf(startOfWeek, 'day', timezone, 7, 'days');
    const nextAfterNextWeek = getStartOf(nextWeek, 'day', timezone, 7, 'days');

    const nextMonth = getStartOf(todayInListingsTZ, 'month', timezone, 1, 'months');
    const nextAfterNextMonth = getStartOf(nextMonth, 'month', timezone, 1, 'months');

    const sharedData = { listingId, timeZone: timezone };

    // Fetch data for selected week and nearest weeks for WeeklyCalendar
    // Plus current month and month after that for EditListingAvailabilityForm
    //
    // NOTE: This is making 5 different Thunk calls, which update store 2 times each
    //       It would make sense to make on thunk function that fires 5 sdk calls/promises,
    //       but for the time being, it's clearer to push all the calls through
    //       requestFetchAvailabilityExceptions
    return Promise.all([
      dispatch(
        requestFetchAvailabilityExceptions({
          ...sharedData,
          isWeekly: true,
          start: prevWeek,
          end: startOfWeek,
        })
      ),
      dispatch(
        requestFetchAvailabilityExceptions({
          ...sharedData,
          isWeekly: true,
          start: startOfWeek,
          end: nextWeek,
        })
      ),
      dispatch(
        requestFetchAvailabilityExceptions({
          ...sharedData,
          isWeekly: true,
          start: nextWeek,
          end: nextAfterNextWeek,
        })
      ),
      dispatch(
        requestFetchAvailabilityExceptions({
          ...sharedData,
          start: todayInListingsTZ,
          end: nextMonth,
        })
      ),
      dispatch(
        requestFetchAvailabilityExceptions({
          ...sharedData,
          start: nextMonth,
          end: nextAfterNextMonth,
        })
      ),
    ]);
  }

  // By default return an empty array
  return Promise.all([]);
};

// ================ Slice ================ //

const initialState = {
  // Error instance placeholders for each endpoint
  createListingDraftError: null,
  listingId: null,
  publishListingError: null,
  updateListingError: null,
  showListingsError: null,
  uploadImageError: null,
  setStockError: null,
  setStockInProgress: false,
  createListingDraftInProgress: false,
  submittedListingId: null,
  redirectToListing: false,
  uploadedImages: {},
  uploadedImagesOrder: [],
  removedImageIds: [],
  addExceptionError: null,
  addExceptionInProgress: false,
  weeklyExceptionQueries: {
    // '2022-12-12': { // Note: id/key is the start of the week in given time zone
    //   fetchExceptionsError: null,
    //   fetchExceptionsInProgress: null,
    // },
  },
  monthlyExceptionQueries: {
    // '2022-12': {
    //   fetchExceptionsError: null,
    //   fetchExceptionsInProgress: null,
    // },
  },
  allExceptions: [],
  deleteExceptionError: null,
  deleteExceptionInProgress: false,
  listingDraft: null,
  updatedTab: null,
  updateInProgress: false,
  payoutDetailsSaveInProgress: false,
  payoutDetailsSaved: false,
};

const editListingPageSlice = createSlice({
  name: 'EditListingPage',
  initialState,
  reducers: {
    markTabUpdated: (state, action) => {
      state.updatedTab = action.payload;
    },
    clearUpdatedTab: state => {
      state.updatedTab = null;
      state.updateListingError = null;
    },
    clearPublishError: state => {
      state.publishListingError = null;
    },
    removeListingImage: (state, action) => {
      const id = action.payload;

      // Only mark the image removed if it hasn't been added to the
      // listing already
      const removedImageIds = state.uploadedImages[id]
        ? state.removedImageIds
        : state.removedImageIds.concat(id);

      // Always remove from the draft since it might be a new image to
      // an existing listing.
      const uploadedImages = omit(state.uploadedImages, id);
      const uploadedImagesOrder = state.uploadedImagesOrder.filter(i => i !== id);

      state.uploadedImages = uploadedImages;
      state.uploadedImagesOrder = uploadedImagesOrder;
      state.removedImageIds = removedImageIds;
    },
  },
  extraReducers: builder => {
    builder
      // createListingDraft cases
      .addCase(createListingDraftThunk.pending, state => {
        state.createListingDraftInProgress = true;
        state.createListingDraftError = null;
        state.submittedListingId = null;
        state.listingDraft = null;
      })
      .addCase(createListingDraftThunk.fulfilled, (state, action) => {
        const updatedImagesState = updateUploadedImagesState(state, action.payload.data);
        state.uploadedImages = updatedImagesState.uploadedImages;
        state.uploadedImagesOrder = updatedImagesState.uploadedImagesOrder;
        state.createListingDraftInProgress = false;
        state.submittedListingId = action.payload.data.data.id;
        state.listingDraft = action.payload.data.data;
      })
      .addCase(createListingDraftThunk.rejected, (state, action) => {
        state.createListingDraftInProgress = false;
        state.createListingDraftError = action.payload;
      })
      // publishListing cases
      .addCase(publishListingThunk.pending, (state, action) => {
        state.listingId = action.meta.arg.listingId;
        state.publishListingError = null;
      })
      .addCase(publishListingThunk.fulfilled, state => {
        state.redirectToListing = true;
        state.createListingDraftError = null;
        state.updateListingError = null;
        state.showListingsError = null;
        state.uploadImageError = null;
        state.createListingDraftInProgress = false;
        state.updateInProgress = false;
      })
      .addCase(publishListingThunk.rejected, (state, action) => {
        console.error(action.payload);
        state.publishListingError = {
          listingId: state.listingId,
          error: action.payload,
        };
      })
      // updateListing cases
      .addCase(updateListingThunk.pending, state => {
        state.updateInProgress = true;
        state.updateListingError = null;
      })
      .addCase(updateListingThunk.fulfilled, (state, action) => {
        const updatedImagesState = updateUploadedImagesState(state, action.payload.response.data);
        state.uploadedImages = updatedImagesState.uploadedImages;
        state.uploadedImagesOrder = updatedImagesState.uploadedImagesOrder;
        state.updateInProgress = false;
        state.updatedTab = action.payload.tab;
      })
      .addCase(updateListingThunk.rejected, (state, action) => {
        state.updateInProgress = false;
        state.updateListingError = action.payload;
      })
      // showListing cases
      .addCase(showListingThunk.pending, state => {
        state.showListingsError = null;
      })
      .addCase(showListingThunk.fulfilled, (state, action) => {
        const listingIdFromPayload = action.payload.data.data.id;
        const { listingId, allExceptions, weeklyExceptionQueries, monthlyExceptionQueries } = state;
        // If listing stays the same, we trust previously fetched exception data.
        if (listingIdFromPayload?.uuid === state.listingId?.uuid) {
          Object.assign(state, initialState);
          state.listingId = listingId;
          state.allExceptions = allExceptions;
          state.weeklyExceptionQueries = weeklyExceptionQueries;
          state.monthlyExceptionQueries = monthlyExceptionQueries;
        } else {
          Object.assign(state, initialState);
          state.listingId = listingIdFromPayload;
        }
      })
      .addCase(showListingThunk.rejected, (state, action) => {
        console.error(action.payload);
        state.showListingsError = action.payload;
        state.redirectToListing = false;
      })
      // uploadImage cases
      .addCase(uploadImageThunk.pending, (state, action) => {
        const params = action.meta.arg.actionPayload;
        const id = params.id;
        // payload.params: { id: 'tempId', file }
        const uploadedImages = {
          ...state.uploadedImages,
          [id]: { ...params },
        };
        state.uploadedImages = uploadedImages;
        state.uploadedImagesOrder = state.uploadedImagesOrder.concat([id]);
        state.uploadImageError = null;
      })
      .addCase(uploadImageThunk.fulfilled, (state, action) => {
        // payload.data: { id: 'tempId', imageId: 'some-real-id', attributes, type }
        const { id, ...rest } = action.payload.data;
        state.uploadedImages[id] = { id, ...rest };
      })
      .addCase(uploadImageThunk.rejected, (state, action) => {
        const { id, error } = action.payload;
        state.uploadedImagesOrder = state.uploadedImagesOrder.filter(i => i !== id);
        state.uploadedImages = omit(state.uploadedImages, id);
        state.uploadImageError = error;
      })
      // setStock cases
      .addCase(setStockThunk.pending, state => {
        state.setStockInProgress = true;
        state.setStockError = null;
      })
      .addCase(setStockThunk.fulfilled, state => {
        state.setStockInProgress = false;
      })
      .addCase(setStockThunk.rejected, (state, action) => {
        state.setStockInProgress = false;
        state.setStockError = action.payload;
      })
      // fetchAvailabilityExceptions cases
      .addCase(fetchAvailabilityExceptionsThunk.pending, (state, action) => {
        const { isWeekly, start, timeZone } = action.meta.arg.params;
        const weekStartId = isWeekly ? stringifyDateToISO8601(start) : null;
        const monthId = !isWeekly ? monthIdString(start, timeZone) : null;
        const newData = { fetchExceptionsError: null, fetchExceptionsInProgress: true };

        if (monthId) {
          state.monthlyExceptionQueries[monthId] = {
            ...state.monthlyExceptionQueries[monthId],
            ...newData,
          };
        } else if (weekStartId) {
          state.weeklyExceptionQueries[weekStartId] = {
            ...state.weeklyExceptionQueries[weekStartId],
            ...newData,
          };
        }
      })
      .addCase(fetchAvailabilityExceptionsThunk.fulfilled, (state, action) => {
        const { exceptions, monthId, weekStartId } = action.payload;
        const combinedExceptions = state.allExceptions.concat(exceptions);
        const selectId = x => x.id.uuid;
        state.allExceptions = uniqueBy(combinedExceptions, selectId).sort(
          sortExceptionsByStartTime
        );

        const newData = { fetchExceptionsInProgress: false };
        if (monthId) {
          state.monthlyExceptionQueries[monthId] = {
            ...state.monthlyExceptionQueries[monthId],
            ...newData,
          };
        } else if (weekStartId) {
          state.weeklyExceptionQueries[weekStartId] = {
            ...state.weeklyExceptionQueries[weekStartId],
            ...newData,
          };
        }
      })
      .addCase(fetchAvailabilityExceptionsThunk.rejected, (state, action) => {
        const { monthId, weekStartId, error } = action.payload;
        const newData = { fetchExceptionsInProgress: false, fetchExceptionsError: error };

        if (monthId) {
          state.monthlyExceptionQueries[monthId] = {
            ...state.monthlyExceptionQueries[monthId],
            ...newData,
          };
        } else if (weekStartId) {
          state.weeklyExceptionQueries[weekStartId] = {
            ...state.weeklyExceptionQueries[weekStartId],
            ...newData,
          };
        }
      })
      // fetchExtraAvailabilityExceptions cases
      .addCase(fetchExtraAvailabilityExceptionsThunk.fulfilled, (state, action) => {
        const combinedExceptions = state.allExceptions.concat(action.payload.exceptions);
        const selectId = x => x.id.uuid;
        state.allExceptions = uniqueBy(combinedExceptions, selectId).sort(
          sortExceptionsByStartTime
        );
      })
      // addAvailabilityException cases
      .addCase(addAvailabilityExceptionThunk.pending, state => {
        state.addExceptionError = null;
        state.addExceptionInProgress = true;
      })
      .addCase(addAvailabilityExceptionThunk.fulfilled, (state, action) => {
        const exception = action.payload.data;
        const combinedExceptions = state.allExceptions.concat(exception);
        state.allExceptions = combinedExceptions.sort(sortExceptionsByStartTime);
        state.addExceptionInProgress = false;
      })
      .addCase(addAvailabilityExceptionThunk.rejected, (state, action) => {
        state.addExceptionError = action.payload.error;
        state.addExceptionInProgress = false;
      })
      // deleteAvailabilityException cases
      .addCase(deleteAvailabilityExceptionThunk.pending, state => {
        state.deleteExceptionError = null;
        state.deleteExceptionInProgress = true;
      })
      .addCase(deleteAvailabilityExceptionThunk.fulfilled, (state, action) => {
        const exception = action.payload.data;
        const id = exception.id.uuid;
        state.allExceptions = state.allExceptions.filter(e => e.id.uuid !== id);
        state.deleteExceptionInProgress = false;
      })
      .addCase(deleteAvailabilityExceptionThunk.rejected, (state, action) => {
        state.deleteExceptionError = action.payload.error;
        state.deleteExceptionInProgress = false;
      })
      // savePayoutDetails cases
      .addCase(savePayoutDetailsThunk.pending, state => {
        state.payoutDetailsSaveInProgress = true;
      })
      .addCase(savePayoutDetailsThunk.fulfilled, state => {
        state.payoutDetailsSaveInProgress = false;
        state.payoutDetailsSaved = true;
      })
      .addCase(savePayoutDetailsThunk.rejected, state => {
        state.payoutDetailsSaveInProgress = false;
      });
  },
});

export const {
  markTabUpdated,
  clearUpdatedTab,
  clearPublishError,
  removeListingImage,
} = editListingPageSlice.actions;
export default editListingPageSlice.reducer;

// ================ Load data ================ //

// loadData is run for each tab of the wizard. When editing an
// existing listing, the listing must be fetched first.
export const loadData = (params, search, config) => (dispatch, getState, sdk) => {
  dispatch(clearUpdatedTab());
  dispatch(clearPublishError());
  const { id, type } = params;
  const fetchCurrentUserOptions = {
    updateNotifications: false,
  };

  if (type === 'new') {
    // No need to listing data when creating a new listing
    return Promise.all([dispatch(fetchCurrentUser(fetchCurrentUserOptions))])
      .then(response => {
        const currentUser = getState().user.currentUser;
        if (currentUser && currentUser.stripeAccount) {
          dispatch(fetchStripeAccount());
        }
        return response;
      })
      .catch(e => {
        throw e;
      });
  }

  const payload = { id: new UUID(id) };
  return Promise.all([
    dispatch(requestShowListing(payload, config)),
    dispatch(fetchCurrentUser(fetchCurrentUserOptions)),
  ])
    .then(response => {
      const currentUser = getState().user.currentUser;

      // Do not fetch extra information if user is in pending-approval state.
      if (isUserAuthorized(currentUser)) {
        if (currentUser && currentUser.stripeAccount) {
          dispatch(fetchStripeAccount());
        }

        // Because of two dispatch functions, response is an array.
        // We are only interested in the response from requestShowListing here,
        // so we need to pick the first one
        const listing = response[0]?.data?.data;
        const transactionProcessAlias = listing?.attributes?.publicData?.transactionProcessAlias;
        if (listing && isBookingProcessAlias(transactionProcessAlias)) {
          fetchLoadDataExceptions(dispatch, listing, search, config.localization.firstDayOfWeek);
        }
      }

      return response;
    })
    .catch(e => {
      throw e;
    });
};
