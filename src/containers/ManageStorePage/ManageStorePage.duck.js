import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';

import { denormalisedResponseEntities } from '../../util/data';
import { storableError } from '../../util/errors';
import { getCurrentWorkspace } from '../../util/xololoTeam';
import { updateStoreSettingsAs } from '../../util/apiAsWorkspace';
import { setCurrentUser, fetchCurrentUser } from '../../ducks/user.duck';

// XOLOLO: página /account/store donde el seller edita el branding de su
// storefront y activa/desactiva calendario. Guarda los cambios en
// publicData vía sdk.currentUser.updateProfile — el user actualiza sus
// propios campos (no necesita Integration API para esto).
// XOLOLO · E9: en modo colaborador, el save va al wrapper
// /api/team/as/store/settings que actualiza al admin del workspace via
// Integration SDK (filtra keys sensibles).

const saveStorePayloadCreator = (
  publicData,
  { dispatch, getState, extra: sdk, rejectWithValue }
) => {
  const workspace = getCurrentWorkspace(getState().user?.currentUser);

  if (workspace) {
    return updateStoreSettingsAs(workspace.sellerId, { publicData })
      .then(() => {
        // El wrapper actualiza al admin via Integration SDK; el currentUser
        // del colaborador no cambia. Refrescamos currentUser para que el
        // ribbon/switcher y getCurrentWorkspace lean los datos actualizados.
        dispatch(fetchCurrentUser({ updateNotifications: false })).catch(() => null);
        return null;
      })
      .catch(e => {
        return rejectWithValue(storableError(e));
      });
  }

  return sdk.currentUser
    .updateProfile(
      { publicData },
      {
        expand: true,
        include: ['profileImage'],
        'fields.image': ['variants.square-small', 'variants.square-small2x'],
      }
    )
    .then(response => {
      const entities = denormalisedResponseEntities(response);
      if (entities.length !== 1) {
        throw new Error('Expected a resource in updateProfile response');
      }
      dispatch(setCurrentUser(entities[0]));
      return entities[0];
    })
    .catch(e => {
      return rejectWithValue(storableError(e));
    });
};

export const saveStoreThunk = createAsyncThunk(
  'ManageStorePage/saveStore',
  saveStorePayloadCreator
);

export const saveStore = publicData => dispatch => dispatch(saveStoreThunk(publicData)).unwrap();

const initialState = {
  saveStoreInProgress: false,
  saveStoreError: null,
  storeSaved: false,
};

const manageStorePageSlice = createSlice({
  name: 'ManageStorePage',
  initialState,
  reducers: {
    saveStoreClear: state => {
      state.storeSaved = false;
      state.saveStoreError = null;
    },
  },
  extraReducers: builder => {
    builder
      .addCase(saveStoreThunk.pending, state => {
        state.saveStoreInProgress = true;
        state.saveStoreError = null;
        state.storeSaved = false;
      })
      .addCase(saveStoreThunk.fulfilled, state => {
        state.saveStoreInProgress = false;
        state.storeSaved = true;
      })
      .addCase(saveStoreThunk.rejected, (state, action) => {
        state.saveStoreInProgress = false;
        state.saveStoreError = action.payload;
      });
  },
});

export const { saveStoreClear } = manageStorePageSlice.actions;
export default manageStorePageSlice.reducer;
