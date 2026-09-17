import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';

import { denormalisedResponseEntities } from '../../util/data';
import { storableError } from '../../util/errors';
import { setCurrentUser } from '../../ducks/user.duck';

// XOLOLO: página /account/store donde el seller edita el branding de su
// storefront y activa/desactiva calendario. Guarda los cambios en
// publicData vía sdk.currentUser.updateProfile — el user actualiza sus
// propios campos (no necesita Integration API para esto).

const saveStorePayloadCreator = (
  publicData,
  { dispatch, extra: sdk, rejectWithValue }
) => {
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

export const saveStore = publicData => dispatch =>
  dispatch(saveStoreThunk(publicData)).unwrap();

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
