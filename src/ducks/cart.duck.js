import { createSlice } from '@reduxjs/toolkit';

// XOLOLO: carrito multi-producto por seller (Cart.1).
//
// Contexto de negocio: los carritos NO son multi-seller (decisión de
// v1 en docs/LOGISTICS_V1.md §7). Cada carrito pertenece a un solo
// vendedor. Si el buyer quiere productos de 2 tiendas, hace 2
// checkouts separados.
//
// Estructura del state:
//   {
//     bySellerId: {
//       "<sellerId>": {
//         sellerId,
//         sellerDisplayName,
//         sellerSlug,
//         items: [
//           { listingId, listingTitle, listingImageUrl, price, quantity, addedAt }
//         ],
//         updatedAt,
//       }
//     }
//   }
//
// Persistencia: se hidrata desde localStorage al montar (thunk
// hydrateCartsFromStorage) y se serializa a localStorage en cada
// mutation. Key: 'xololo-carts-v1'. SSR-safe (no toca window si no
// existe).
//
// La UI selecciona el carrito ACTIVO por el contexto:
// - En una ListingPage → el seller del listing
// - En el StorefrontPage → el seller del subdominio
// - En una CartPage/CheckoutPage → el seller pasado por param

// XOLOLO Bug 1: la key del storage se escopea por userId. Antes usaba
// una key global 'xololo-carts-v1' que hacía que un browser compartido
// (ej. proveedor y comprador logueados en el mismo Chrome, uno tras
// otro) viera el carrito del OTRO en su topbar. Ahora:
//   - usuario logueado → 'xololo-carts-v1:<userId>'
//   - sin auth        → 'xololo-carts-v1:guest'
// Cambio de identidad = re-hidrata desde la key correcta (ver
// CartUserSync + setCartUser en app.js).
const STORAGE_KEY_LEGACY = 'xololo-carts-v1';
const STORAGE_KEY_PREFIX = 'xololo-carts-v1:';
const GUEST_KEY = 'guest';

const isBrowser = () => typeof window !== 'undefined' && !!window.localStorage;

const storageKeyFor = userId => `${STORAGE_KEY_PREFIX}${userId || GUEST_KEY}`;

const readStorage = userId => {
  if (!isBrowser()) return {};
  try {
    const raw = window.localStorage.getItem(storageKeyFor(userId));
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed?.bySellerId || {};
  } catch (e) {
    return {};
  }
};

const writeStorage = (bySellerId, userId) => {
  if (!isBrowser()) return;
  try {
    window.localStorage.setItem(
      storageKeyFor(userId),
      JSON.stringify({ bySellerId })
    );
  } catch (e) {
    // storage full o disabled — no rompe la app
  }
};

// Limpia la key legacy (sin scoping) en el primer boot para evitar
// que un carrito viejo compartido siga colgado. Es fire-and-forget.
const purgeLegacyStorage = () => {
  if (!isBrowser()) return;
  try {
    window.localStorage.removeItem(STORAGE_KEY_LEGACY);
  } catch (e) {
    /* noop */
  }
};

const initialState = {
  bySellerId: {},
  hydrated: false,
  // XOLOLO Bug 1: id del user cuyo carrito está montado en state.
  // null = sesión guest. Cualquier mutation escribe en la key de este user.
  currentUserId: null,
};

// Helper: consolida un carrito (dedupe items por listingId sumando cantidades).
const upsertItem = (cart, incoming) => {
  const existingIdx = cart.items.findIndex(i => i.listingId === incoming.listingId);
  if (existingIdx >= 0) {
    const next = [...cart.items];
    next[existingIdx] = {
      ...next[existingIdx],
      quantity: next[existingIdx].quantity + incoming.quantity,
      addedAt: incoming.addedAt,
    };
    return { ...cart, items: next };
  }
  return { ...cart, items: [...cart.items, incoming] };
};

const cartSlice = createSlice({
  name: 'cart',
  initialState,
  reducers: {
    // Hidrata desde la key GUEST al arranque de la app (antes de saber
    // si hay user logueado). CartUserSync después llama setCartUser
    // con el userId real y re-hidrata desde la key correcta.
    hydrateFromStorage: state => {
      purgeLegacyStorage();
      state.bySellerId = readStorage(null);
      state.currentUserId = null;
      state.hydrated = true;
    },
    // XOLOLO Bug 1: llamado por CartUserSync cuando cambia la
    // identidad del user (login/logout/switch de cuenta en el mismo
    // browser). Re-lee la storage de ESE user — el carrito del user
    // anterior NO se pierde (sigue en su propia key) pero deja de
    // verse en state.
    setCartUser: (state, action) => {
      const nextUserId = action.payload?.userId || null;
      if (state.currentUserId === nextUserId && state.hydrated) return;
      state.bySellerId = readStorage(nextUserId);
      state.currentUserId = nextUserId;
      state.hydrated = true;
    },
    addToCart: (state, action) => {
      const { sellerId, sellerDisplayName, sellerSlug, item } = action.payload;
      if (!sellerId || !item?.listingId) return;
      const nowIso = new Date().toISOString();
      const existing = state.bySellerId[sellerId] || {
        sellerId,
        sellerDisplayName,
        sellerSlug,
        items: [],
        updatedAt: nowIso,
      };
      const withItem = upsertItem(existing, {
        listingId: item.listingId,
        listingTitle: item.listingTitle,
        listingImageUrl: item.listingImageUrl || null,
        price: item.price, // {amount, currency}
        quantity: Math.max(1, Number(item.quantity) || 1),
        addedAt: nowIso,
      });
      state.bySellerId[sellerId] = {
        ...withItem,
        // metadatos del seller pueden refrescarse por si cambió su
        // displayName o slug entre visitas
        sellerDisplayName: sellerDisplayName || withItem.sellerDisplayName,
        sellerSlug: sellerSlug || withItem.sellerSlug,
        updatedAt: nowIso,
      };
      writeStorage(state.bySellerId, state.currentUserId);
    },
    updateQuantity: (state, action) => {
      const { sellerId, listingId, quantity } = action.payload;
      const cart = state.bySellerId[sellerId];
      if (!cart) return;
      const nowIso = new Date().toISOString();
      const q = Math.max(0, Number(quantity) || 0);
      if (q === 0) {
        cart.items = cart.items.filter(i => i.listingId !== listingId);
      } else {
        const idx = cart.items.findIndex(i => i.listingId === listingId);
        if (idx >= 0) cart.items[idx] = { ...cart.items[idx], quantity: q };
      }
      cart.updatedAt = nowIso;
      if (cart.items.length === 0) {
        delete state.bySellerId[sellerId];
      } else {
        state.bySellerId[sellerId] = { ...cart };
      }
      writeStorage(state.bySellerId, state.currentUserId);
    },
    removeItem: (state, action) => {
      const { sellerId, listingId } = action.payload;
      const cart = state.bySellerId[sellerId];
      if (!cart) return;
      cart.items = cart.items.filter(i => i.listingId !== listingId);
      cart.updatedAt = new Date().toISOString();
      if (cart.items.length === 0) delete state.bySellerId[sellerId];
      else state.bySellerId[sellerId] = { ...cart };
      writeStorage(state.bySellerId, state.currentUserId);
    },
    clearSellerCart: (state, action) => {
      const { sellerId } = action.payload;
      delete state.bySellerId[sellerId];
      writeStorage(state.bySellerId, state.currentUserId);
    },
  },
});

export const {
  hydrateFromStorage,
  setCartUser,
  addToCart,
  updateQuantity,
  removeItem,
  clearSellerCart,
} = cartSlice.actions;

// ---------- Selectors ----------

export const selectCartHydrated = state => state.cart?.hydrated || false;

export const selectCartForSeller = sellerId => state =>
  state.cart?.bySellerId?.[sellerId] || null;

export const selectCartItemCount = sellerId => state => {
  const cart = state.cart?.bySellerId?.[sellerId];
  if (!cart) return 0;
  return cart.items.reduce((sum, i) => sum + (Number(i.quantity) || 0), 0);
};

export const selectCartSubtotal = sellerId => state => {
  const cart = state.cart?.bySellerId?.[sellerId];
  if (!cart) return { amount: 0, currency: 'MXN' };
  return cart.items.reduce(
    (acc, i) => ({
      amount: acc.amount + (i.price?.amount || 0) * (i.quantity || 0),
      currency: i.price?.currency || acc.currency,
    }),
    { amount: 0, currency: 'MXN' }
  );
};

export const selectAllCarts = state =>
  Object.values(state.cart?.bySellerId || {});

export default cartSlice.reducer;
