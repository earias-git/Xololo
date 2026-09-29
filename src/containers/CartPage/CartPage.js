import React, { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useHistory } from 'react-router-dom';

import { formatMoney } from '../../util/currency';
import { useIntl } from '../../util/reactIntl';
import { useConfiguration } from '../../context/configurationContext';
import { useRouteConfiguration } from '../../context/routeConfigurationContext';
import { createResourceLocatorString, findRouteByRouteName } from '../../util/routes';
import { createSlug } from '../../util/urlHelpers';
import { types as sdkTypes } from '../../util/sdkLoader';
import { isScrollingDisabled } from '../../ducks/ui.duck';
import { initializeCardPaymentData } from '../../ducks/stripe.duck';
import { getListingsById } from '../../ducks/marketplaceData.duck';
import { showListing } from '../ListingPage/ListingPage.duck';
import {
  selectCartForSeller,
  selectCartHydrated,
  updateQuantity,
  removeItem,
  clearSellerCart,
} from '../../ducks/cart.duck';
import {
  getShippingMethodsFromListing,
  intersectShippingMethods,
  METHOD_PICKUP,
  METHOD_LOCAL_DELIVERY,
  METHOD_SKYDROPX,
  METHOD_FREIGHT,
} from '../../util/xololoShippingMethods';
import { deriveLegacyDeliveryMethod } from '../../components/OrderPanel/ProductOrderForm/XololoShippingMethodField';

import { LayoutSingleColumn, Page, SellerBrandFrame, XololoShippingMethodSelector } from '../../components';
import TopbarContainer from '../TopbarContainer/TopbarContainer';
import FooterContainer from '../FooterContainer/FooterContainer';

import css from './CartPage.module.css';

const { Money, UUID } = sdkTypes;

// XOLOLO Cart.4: página del carrito de un seller específico.
// Ruta: /cart/:sellerId
//
// Muestra:
//  - Lista editable de items (thumbnail, título, precio, qty ± , subtotal, remover)
//  - Subtotal general
//  - Botón "Ir a checkout" que llama al server multi-item (Cart.5)
//  - Botón "Seguir comprando" que regresa al storefront del seller
//  - Botón "Vaciar carrito"
//
// El sellerId viene de la URL. Si no hay carrito con ese sellerId,
// mostramos estado vacío con link al home.
//
// El seller (con branding) se pide al server para envolver todo en
// SellerBrandFrame — así el buyer ve la CartPage con branding de la
// tienda (colores, logo).

const useSellerBySlug = sellerId => {
  const [seller, setSeller] = useState(null);
  useEffect(() => {
    let cancelled = false;
    if (!sellerId) return;
    // Fetch al endpoint interno /api/seller-by-id (creamos abajo si no existe;
    // por ahora reutilizamos /api/seller-by-slug pasando slug, o hidratamos
    // datos mínimos del carrito). Para MVP consultamos por slug si tenemos
    // uno en el cart.sellerSlug; si no, dejamos seller=null y el
    // SellerBrandFrame usa fallback default.
    return () => {
      cancelled = true;
    };
  }, [sellerId]);
  return seller;
};

const CartPage = props => {
  const config = useConfiguration();
  const routes = useRouteConfiguration();
  const history = useHistory();
  const intl = useIntl();
  const dispatch = useDispatch();
  const params = props?.params || {};
  const sellerId = params.sellerId;

  const scrollingDisabled = useSelector(isScrollingDisabled);
  const hydrated = useSelector(selectCartHydrated);
  const cart = useSelector(sellerId ? selectCartForSeller(sellerId) : () => null);
  const currentUser = useSelector(state => state.user?.currentUser || null);
  const [redirecting, setRedirecting] = useState(false);
  const [checkoutError, setCheckoutError] = useState(null);
  // XOLOLO Envíos v2 + carrito multi-producto: fetcheamos TODOS los
  // listings del carrito para computar la INTERSECCIÓN de métodos de
  // envío. Sólo se muestran los métodos que TODOS los productos
  // soportan; si la intersección es vacía, mostramos mensaje con
  // botones para quitar productos incompatibles.
  const [allListings, setAllListings] = useState([]);
  const [xoloSelectedMethod, setXoloSelectedMethod] = useState(null);

  const listingIdsKey = cart?.items?.map(i => i.listingId).join(',') || '';
  useEffect(() => {
    if (!listingIdsKey) return;
    const ids = listingIdsKey.split(',').filter(Boolean);
    if (ids.length === 0) return;
    const uuids = ids.map(id => new UUID(id));
    Promise.all(uuids.map(u => dispatch(showListing(u, config))))
      .then(() => {
        dispatch((_, getState) => {
          const denorm = getListingsById(getState(), uuids).filter(Boolean);
          setAllListings(denorm);
        });
      })
      .catch(() => {
        // silencioso
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listingIdsKey]);
  const primaryListing = allListings[0] || null;

  // Espera a hidratación desde localStorage para no mostrar "carrito vacío"
  // en el primer render antes de leer el storage.
  if (!hydrated) {
    return (
      <Page title="Carrito" scrollingDisabled={scrollingDisabled}>
        <LayoutSingleColumn topbar={<TopbarContainer />} footer={<FooterContainer />}>
          <div className={css.emptyRoot}>
            <p className={css.emptyText}>Cargando tu carrito…</p>
          </div>
        </LayoutSingleColumn>
      </Page>
    );
  }

  if (!cart || cart.items.length === 0) {
    return (
      <Page title="Carrito vacío" scrollingDisabled={scrollingDisabled}>
        <LayoutSingleColumn topbar={<TopbarContainer />} footer={<FooterContainer />}>
          <div className={css.emptyRoot}>
            <h1 className={css.emptyTitle}>Tu carrito está vacío</h1>
            <p className={css.emptyText}>
              Cuando agregues productos aparecerán aquí para que los revises
              antes de pagar.
            </p>
            <a href="/" className={css.primaryBtn}>Ir al inicio</a>
          </div>
        </LayoutSingleColumn>
      </Page>
    );
  }

  const currency = cart.items[0]?.price?.currency || config.currency || 'MXN';
  const subtotalAmount = cart.items.reduce(
    (sum, i) => sum + (i.price?.amount || 0) * (i.quantity || 0),
    0
  );
  const subtotalMoney = new Money(Math.round(subtotalAmount), currency);
  const totalItems = cart.items.reduce((sum, i) => sum + (i.quantity || 0), 0);

  // XOLOLO Envíos v2 + carrito multi-producto: intersección de métodos
  // entre todos los listings. Si sólo hay 1 item, la intersección es
  // simplemente sus métodos. Si hay 2+, sólo aparecen los métodos que
  // TODOS soportan.
  const { methods: xoloShippingMethods, intersectionKeys } =
    allListings.length > 0
      ? intersectShippingMethods(allListings)
      : { methods: null, intersectionKeys: [] };
  const xoloEnabledCount = intersectionKeys.length;
  const showXoloMethodSelector = xoloEnabledCount > 0;
  // Detección de conflicto: hay al menos 2 items, todos con métodos v2
  // configurados, pero la intersección es vacía. Renderemos mensaje.
  const anyListingHasV2 = allListings.some(l => {
    const m = getShippingMethodsFromListing(l);
    return [m?.pickup?.enabled, m?.localDelivery?.enabled, m?.skydropxCarrier?.enabled, m?.freight?.enabled].some(Boolean);
  });
  const hasIncompatibleMethods =
    allListings.length >= 2 && anyListingHasV2 && intersectionKeys.length === 0;
  const xoloDefaultMethod = intersectionKeys[0] || null;
  // Marca por item los métodos que soporta — útil para mostrar en el
  // fallback de "productos incompatibles".
  const perItemMethods = allListings.map(l => ({
    listingId: l.id?.uuid,
    methods: getShippingMethodsFromListing(l),
  }));
  const xoloCurrencyFormatter = subunits => {
    const n = Number(subunits) || 0;
    if (n === 0) return 'Gratis';
    try {
      return formatMoney(intl, new Money(Math.round(n), currency));
    } catch (e) {
      return `$${(n / 100).toFixed(2)}`;
    }
  };
  // Buyer debe elegir método si hay v2 methods intersecting; también
  // se bloquea si hay incompatibilidad (buyer debe quitar productos).
  const methodChosenOrDefault = xoloSelectedMethod || xoloDefaultMethod;
  const methodBlockingCheckout =
    hasIncompatibleMethods ||
    (showXoloMethodSelector && !methodChosenOrDefault);

  const handleQty = (listingId, nextQty) => {
    dispatch(updateQuantity({ sellerId, listingId, quantity: Math.max(0, nextQty) }));
  };

  const handleRemove = listingId => {
    dispatch(removeItem({ sellerId, listingId }));
  };

  const handleClear = () => {
    if (window.confirm('¿Vaciar completamente el carrito de esta tienda?')) {
      dispatch(clearSellerCart({ sellerId }));
    }
  };

  const handleCheckout = async () => {
    // XOLOLO Cart.5: checkout multi-item.
    // Estrategia:
    //  1. El primer item del carrito es el "primary listing" — su
    //     transaction process (default-purchase), su publicData de
    //     envío, y su stock reservation se usan para la orden.
    //  2. Los items adicionales viajan en orderData.additionalCartItems
    //     y el server los agrega como líneas 'line-item/item' extras.
    //  3. La comisión se recalcula sobre el total agregado en
    //     server/api-util/lineItems.js.
    //  4. Redirigimos a la CheckoutPage estándar (/l/:slug/:id/checkout).
    setRedirecting(true);
    setCheckoutError(null);
    try {
      const primary = cart.items[0];
      const rest = cart.items.slice(1);

      // Hidrata la primary listing en el store — necesitamos la entidad
      // Sharetribe completa (author, price, publicData) para el checkout.
      const primaryUuid = new UUID(primary.listingId);
      await dispatch(showListing(primaryUuid, config));

      // Releemos el store (post-hidratación) vía un thunk trivial para
      // obtener el listing denormalizado con sus relaciones.
      const listing = await new Promise(resolve => {
        dispatch((_, getState) => {
          const [l] = getListingsById(getState(), [primaryUuid]);
          resolve(l || null);
        });
      });

      if (!listing) {
        throw new Error('No se pudo cargar el producto principal.');
      }

      const additionalCartItems = rest.map(i => ({
        listingId: i.listingId,
        quantity: i.quantity,
        // XOLOLO: title e image son sólo para DISPLAY en el checkout
        // (breakdown + sidebar). El server no confía en estos valores —
        // re-lee cada listing y usa el título/precio real.
        // Campos en el cart storage: listingTitle, listingImageUrl.
        title: i.listingTitle,
        image: i.listingImageUrl || null,
      }));

      // XOLOLO Envíos v2: el método elegido en la CartPage viaja como
      // orderData.selectedShippingMethod. El deliveryMethod legacy se
      // deriva (pickup/shipping) para satisfacer el proceso Sharetribe.
      const chosenXoloMethod = methodChosenOrDefault;
      const derivedDeliveryMethod =
        deriveLegacyDeliveryMethod(chosenXoloMethod) || 'shipping';
      const initialValues = {
        listing,
        orderData: {
          quantity: primary.quantity,
          deliveryMethod: derivedDeliveryMethod,
          ...(chosenXoloMethod ? { selectedShippingMethod: chosenXoloMethod } : {}),
          ...(additionalCartItems.length > 0 ? { additionalCartItems } : {}),
        },
        confirmPaymentError: null,
      };

      const checkoutRoute = findRouteByRouteName('CheckoutPage', routes);
      const saveToSessionStorage = !currentUser;
      dispatch(checkoutRoute.setInitialValues(initialValues, saveToSessionStorage));

      // Limpia errores previos de Stripe.
      dispatch(initializeCardPaymentData());

      history.push(
        createResourceLocatorString(
          'CheckoutPage',
          routes,
          {
            id: listing.id.uuid,
            slug: createSlug(listing.attributes.title || 'listing'),
          },
          {}
        )
      );
    } catch (e) {
      setRedirecting(false);
      setCheckoutError(e?.message || 'No se pudo iniciar el checkout.');
    }
  };

  // Seller mínimo para SellerBrandFrame — reconstruimos shape esperado
  // (id, attributes.profile.displayName, publicData) desde lo que
  // tenemos en el cart. Si el seller tiene branding lo va a leer del
  // profile fetch — para MVP dejamos null y frame usa fallback default.
  const sellerForFrame = cart.sellerSlug
    ? {
        id: { uuid: cart.sellerId },
        attributes: {
          profile: {
            displayName: cart.sellerDisplayName,
            publicData: {
              slug: cart.sellerSlug,
              // brandPrimaryColor / logoUrl no persistimos en el cart
              // para no inflar localStorage; el frame renderea sin
              // branding (fallback) — aceptable en v1.
            },
          },
        },
      }
    : null;

  return (
    <Page title={`Carrito · ${cart.sellerDisplayName}`} scrollingDisabled={scrollingDisabled}>
      <SellerBrandFrame seller={sellerForFrame}>
        <LayoutSingleColumn
          topbar={sellerForFrame ? null : <TopbarContainer />}
          footer={sellerForFrame ? null : <FooterContainer />}
        >
          <main className={css.root}>
            <header className={css.header}>
              <h1 className={css.title}>Tu carrito</h1>
              <p className={css.subtitle}>
                {totalItems} {totalItems === 1 ? 'producto' : 'productos'} de{' '}
                <strong>{cart.sellerDisplayName}</strong>. Todos se envían juntos
                para ahorrar en paquetería.
              </p>
            </header>

            <ul className={css.items}>
              {cart.items.map(item => {
                const priceMoney = new Money(
                  Math.round((item.price?.amount || 0) * (item.quantity || 0)),
                  item.price?.currency || currency
                );
                return (
                  <li key={item.listingId} className={css.item}>
                    <div className={css.itemThumb}>
                      {item.listingImageUrl ? (
                        <img src={item.listingImageUrl} alt={item.listingTitle} />
                      ) : (
                        <div className={css.itemThumbEmpty}>📦</div>
                      )}
                    </div>
                    <div className={css.itemMain}>
                      <a
                        href={`/l/product/${item.listingId}`}
                        className={css.itemTitle}
                      >
                        {item.listingTitle}
                      </a>
                      <p className={css.itemUnitPrice}>
                        {formatMoney(
                          intl,
                          new Money(Math.round(item.price?.amount || 0), currency)
                        )}{' '}
                        c/u
                      </p>
                    </div>
                    <div className={css.itemQtyBox}>
                      <button
                        type="button"
                        className={css.qtyBtn}
                        onClick={() => handleQty(item.listingId, item.quantity - 1)}
                        aria-label="Menos"
                      >
                        −
                      </button>
                      <input
                        type="number"
                        min={0}
                        max={99}
                        className={css.qtyInput}
                        value={item.quantity}
                        onChange={e =>
                          handleQty(item.listingId, Number.parseInt(e.target.value, 10) || 0)
                        }
                      />
                      <button
                        type="button"
                        className={css.qtyBtn}
                        onClick={() => handleQty(item.listingId, item.quantity + 1)}
                        aria-label="Más"
                      >
                        +
                      </button>
                    </div>
                    <div className={css.itemTotal}>{formatMoney(intl, priceMoney)}</div>
                    <button
                      type="button"
                      className={css.removeBtn}
                      onClick={() => handleRemove(item.listingId)}
                      aria-label="Quitar del carrito"
                    >
                      🗑
                    </button>
                  </li>
                );
              })}
            </ul>

            {/* XOLOLO Envíos v2: selector de método basado en la
                INTERSECCIÓN de métodos que TODOS los productos del
                carrito soportan. Si la intersección es vacía, mostramos
                mensaje explícito con botones "Quitar" en los productos
                que no comparten métodos con los demás. */}
            {hasIncompatibleMethods ? (
              <div
                style={{
                  margin: '20px 0',
                  padding: '16px',
                  border: '1px solid #fecaca',
                  borderRadius: 8,
                  background: '#fef2f2',
                }}
              >
                <h4 style={{ margin: '0 0 8px 0', color: '#991b1b', fontSize: 15 }}>
                  Productos con métodos de entrega incompatibles
                </h4>
                <p style={{ margin: '0 0 12px 0', fontSize: 13, color: '#7f1d1d', lineHeight: 1.5 }}>
                  Los productos en tu carrito no comparten ningún método
                  de entrega en común, por eso no pueden pagarse juntos.
                  Quita alguno de los productos para poder continuar, o
                  crea pedidos separados.
                </p>
                <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {perItemMethods.map(p => {
                    const cartItem = cart.items.find(i => i.listingId === p.listingId);
                    if (!cartItem) return null;
                    const methodLabels = [
                      p.methods?.pickup?.enabled ? 'Recolección' : null,
                      p.methods?.localDelivery?.enabled ? 'Envío local' : null,
                      p.methods?.skydropxCarrier?.enabled ? 'Paquetería' : null,
                      p.methods?.freight?.enabled ? 'Flete' : null,
                    ].filter(Boolean).join(', ') || 'sin métodos configurados';
                    return (
                      <li
                        key={p.listingId}
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          padding: '8px 10px',
                          background: 'var(--colorWhite)',
                          borderRadius: 6,
                          fontSize: 13,
                        }}
                      >
                        <div>
                          <div style={{ fontWeight: 600, color: 'var(--colorGrey900)' }}>
                            {cartItem.listingTitle}
                          </div>
                          <div style={{ fontSize: 12, color: 'var(--colorGrey500)' }}>
                            Soporta: {methodLabels}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleRemove(p.listingId)}
                          style={{
                            background: 'transparent',
                            border: '1px solid #dc2626',
                            color: '#dc2626',
                            borderRadius: 6,
                            padding: '4px 10px',
                            fontSize: 12,
                            cursor: 'pointer',
                          }}
                        >
                          Quitar
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : showXoloMethodSelector ? (
              <div style={{ margin: '20px 0' }}>
                <XololoShippingMethodSelector
                  methods={xoloShippingMethods}
                  value={xoloSelectedMethod || null}
                  defaultMethod={xoloDefaultMethod}
                  onChange={setXoloSelectedMethod}
                  currencyFormatter={xoloCurrencyFormatter}
                />
                {cart.items.length > 1 ? (
                  <p style={{ fontSize: 12, color: 'var(--colorGrey500)', margin: '4px 4px 0 4px' }}>
                    Estos métodos son los que TODOS los productos en tu
                    carrito soportan. La configuración de precio/zona/peso
                    se toma del primer producto.
                  </p>
                ) : null}
              </div>
            ) : null}

            <div className={css.summary}>
              <div className={css.summaryRow}>
                <span>Subtotal ({totalItems} items)</span>
                <strong>{formatMoney(intl, subtotalMoney)}</strong>
              </div>
              <p className={css.summaryHint}>
                {hasIncompatibleMethods
                  ? 'Quita alguno de los productos incompatibles arriba para poder continuar al checkout.'
                  : showXoloMethodSelector
                  ? 'Al ir a checkout capturas dirección de envío. El costo final incluye envío según el método elegido arriba.'
                  : 'Al ir a checkout eliges paquetería + capturas dirección de envío. El costo final incluye tu envío ya cotizado.'}
              </p>
              <div className={css.actions}>
                <a href={cart.sellerSlug ? `https://${cart.sellerSlug}.xololo.mx` : '/'} className={css.linkBtn}>
                  ← Seguir comprando
                </a>
                <button
                  type="button"
                  className={css.linkBtn}
                  onClick={handleClear}
                >
                  Vaciar carrito
                </button>
                <button
                  type="button"
                  className={css.primaryBtn}
                  onClick={handleCheckout}
                  disabled={redirecting || methodBlockingCheckout}
                  title={methodBlockingCheckout ? 'Selecciona un método de entrega arriba' : ''}
                >
                  {redirecting ? 'Un momento…' : 'Ir a checkout →'}
                </button>
              </div>
              {checkoutError ? (
                <p className={css.pendingHint} role="alert">
                  <strong>No se pudo iniciar el checkout:</strong> {checkoutError}
                </p>
              ) : null}
            </div>
          </main>
        </LayoutSingleColumn>
      </SellerBrandFrame>
    </Page>
  );
};

export default CartPage;
