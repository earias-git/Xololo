import { createSlice } from '@reduxjs/toolkit';

// XOLOLO: guarda el "slug" del subdominio de tienda detectado por el server.
// Ej: si el usuario visita https://kike.xololo.mx, el server extrae "kike" y
// hace dispatch de setStorefrontSubdomain('kike') antes del SSR. La
// LandingPage y otras rutas leen este slice para decidir si mostrar el
// storefront de un seller en vez del marketplace general.
//
// slug === null significa "estás en el dominio raíz" (xololo.mx, www, o
// cualquier subdominio reservado). La lista de reservados vive en el
// server/subdomain.js para que no viajen al bundle del cliente.

const initialState = {
  slug: null,
};

const storefrontSubdomainSlice = createSlice({
  name: 'storefrontSubdomain',
  initialState,
  reducers: {
    setStorefrontSubdomain: (state, action) => {
      state.slug = action.payload || null;
    },
  },
});

export const { setStorefrontSubdomain } = storefrontSubdomainSlice.actions;

export const selectStorefrontSlug = state => state.storefrontSubdomain?.slug || null;

export default storefrontSubdomainSlice.reducer;
