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
  groupListingsByCompatibility,
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
  // Cuando hay grupos incompatibles, cada grupo tiene su propio método
  // seleccionado — { [groupIndex]: 'pickup' | 'localDelivery' | ... }
  const [groupSelectedMethods, setGroupSelectedMethods] = useState({});

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

  // XOLOLO Envíos v2 + carrito multi-producto: agrupa por compatibilidad
  // de métodos. Si todos comparten al menos un método → 1 grupo (todo
  // se paga junto). Si no → 2+ grupos, cada uno con su propio checkout.
  const compatibilityGroups = allListings.length > 0
    ? groupListingsByCompatibility(allListings)
    : [];
  const hasMultipleGroups = compatibilityGroups.length > 1;

  // Enriquece los grupos con los cart.items correspondientes.
  const groupsWithCartItems = compatibilityGroups.map((g, idx) => {
    const listingIdsInGroup = new Set(g.listings.map(l => l.id?.uuid).filter(Boolean));
    const cartItemsForGroup = cart.items.filter(ci => listingIdsInGroup.has(ci.listingId));
    const groupSubtotal = cartItemsForGroup.reduce(
      (sum, i) => sum + (i.price?.amount || 0) * (i.quantity || 0),
      0
    );
    return {
      ...g,
      groupIndex: idx,
      cartItems: cartItemsForGroup,
      subtotalMoney: new Money(Math.round(groupSubtotal), currency),
    };
  });

  // Escenario de 1 solo grupo — comportamiento actual (selector único).
  const singleGroup = !hasMultipleGroups && groupsWithCartItems[0];
  const singleGroupMethods = singleGroup?.methods || null;
  const singleGroupIntersection = singleGroup?.intersectionKeys || [];
  const showXoloMethodSelector = singleGroupIntersection.length > 0;
  const xoloShippingMethods = singleGroupMethods;
  const xoloDefaultMethod = singleGroupIntersection[0] || null;
  const xoloCurrencyFormatter = subunits => {
    const n = Number(subunits) || 0;
    if (n === 0) return 'Gratis';
    try {
      return formatMoney(intl, new Money(Math.round(n), currency));
    } catch (e) {
      return `$${(n / 100).toFixed(2)}`;
    }
  };
  // Buyer debe elegir método si hay v2 methods intersecting.
  const methodChosenOrDefault = xoloSelectedMethod || xoloDefaultMethod;
  const methodBlockingCheckout =
    showXoloMethodSelector && !methodChosenOrDefault;

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

  // XOLOLO Envíos v2 (grupos): checkout de un subconjunto de items del
  // carrito. Cuando hay grupos incompatibles, se llama con los items
  // de un grupo específico. Cuando todo es compatible, se llama con
  // todos los items del carrito.
  const doCheckout = async (itemsSubset, chosenMethod) => {
    setRedirecting(true);
    setCheckoutError(null);
    try {
      const primary = itemsSubset[0];
      const rest = itemsSubset.slice(1);

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

      // XOLOLO Envíos v2: el método elegido para este grupo viaja como
      // orderData.selectedShippingMethod. El deliveryMethod legacy se
      // deriva (pickup/shipping) para satisfacer el proceso Sharetribe.
      const chosenXoloMethod = chosenMethod;
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

            {/* XOLOLO Envíos v2 (Option D): grupos por compatibilidad.
                Si todos los productos comparten métodos → 1 grupo (todo
                se paga junto). Si no → 2+ grupos, cada uno con su
                propio selector + botón "Comprar este grupo". */}
            {hasMultipleGroups ? (
              <div style={{ margin: '20px 0' }}>
                <div
                  style={{
                    padding: '12px 14px',
                    marginBottom: 16,
                    border: '1px solid #fde68a',
                    borderRadius: 8,
                    background: '#fffbeb',
                  }}
                >
                  <h4 style={{ margin: '0 0 4px 0', color: '#92400e', fontSize: 14 }}>
                    Necesitas hacer {compatibilityGroups.length} pedidos separados
                  </h4>
                  <p style={{ margin: 0, fontSize: 13, color: '#78350f', lineHeight: 1.5 }}>
                    Los productos en tu carrito tienen métodos de entrega
                    distintos. Cada grupo se paga por separado — no te
                    preocupes, sigues comprando en una sola tienda.
                  </p>
                </div>
                {groupsWithCartItems.map(g => {
                  const groupMethodChosen =
                    groupSelectedMethods[g.groupIndex] || g.intersectionKeys[0] || null;
                  const groupBlocked = !groupMethodChosen;
                  return (
                    <div
                      key={g.groupIndex}
                      style={{
                        margin: '16px 0',
                        padding: '16px',
                        border: '1px solid var(--colorGrey100)',
                        borderRadius: 8,
                        background: 'var(--colorWhite)',
                      }}
                    >
                      <h5 style={{ margin: '0 0 12px 0', fontSize: 14, color: 'var(--colorGrey900)' }}>
                        Grupo {g.groupIndex + 1} · {g.cartItems.length}{' '}
                        {g.cartItems.length === 1 ? 'producto' : 'productos'}
                      </h5>
                      <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 12px 0' }}>
                        {g.cartItems.map(ci => (
                          <li
                            key={ci.listingId}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 10,
                              padding: '6px 0',
                              fontSize: 13,
                              color: 'var(--colorGrey700)',
                            }}
                          >
                            {ci.listingImageUrl ? (
                              <img
                                src={ci.listingImageUrl}
                                alt={ci.listingTitle}
                                style={{ width: 36, height: 36, borderRadius: 4, objectFit: 'cover' }}
                              />
                            ) : null}
                            <span style={{ flex: 1 }}>
                              {ci.listingTitle} × {ci.quantity}
                            </span>
                            <span style={{ fontWeight: 600, color: 'var(--colorGrey900)' }}>
                              {formatMoney(
                                intl,
                                new Money(
                                  Math.round((ci.price?.amount || 0) * (ci.quantity || 0)),
                                  currency
                                )
                              )}
                            </span>
                          </li>
                        ))}
                      </ul>
                      <XololoShippingMethodSelector
                        methods={g.methods}
                        value={groupSelectedMethods[g.groupIndex] || null}
                        defaultMethod={g.intersectionKeys[0] || null}
                        onChange={v =>
                          setGroupSelectedMethods(prev => ({ ...prev, [g.groupIndex]: v }))
                        }
                        currencyFormatter={xoloCurrencyFormatter}
                      />
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          marginTop: 12,
                          paddingTop: 12,
                          borderTop: '1px solid var(--colorGrey100)',
                        }}
                      >
                        <span style={{ fontSize: 13, color: 'var(--colorGrey700)' }}>
                          Subtotal grupo:{' '}
                          <strong style={{ color: 'var(--colorGrey900)' }}>
                            {formatMoney(intl, g.subtotalMoney)}
                          </strong>
                        </span>
                        <button
                          type="button"
                          className={css.primaryBtn}
                          onClick={() => doCheckout(g.cartItems, groupMethodChosen)}
                          disabled={redirecting || groupBlocked}
                          title={groupBlocked ? 'Elige un método arriba' : ''}
                        >
                          Pagar este grupo →
                        </button>
                      </div>
                    </div>
                  );
                })}
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
                    Todos los productos en tu carrito soportan estos
                    métodos. La configuración de precio/zona/peso se
                    toma del primer producto.
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
                {hasMultipleGroups
                  ? 'Los productos se agruparon por compatibilidad de envío. Paga cada grupo por separado usando los botones arriba.'
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
                  onClick={() => doCheckout(cart.items, methodChosenOrDefault)}
                  disabled={redirecting || methodBlockingCheckout || hasMultipleGroups}
                  title={
                    hasMultipleGroups
                      ? 'Usa los botones "Pagar este grupo" arriba'
                      : methodBlockingCheckout
                      ? 'Selecciona un método de entrega arriba'
                      : ''
                  }
                  style={hasMultipleGroups ? { display: 'none' } : {}}
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
