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
  // XOLOLO Envíos v2 (rediseño): el buyer elige el método aquí en la
  // CartPage — así llega al checkout con el método fijado, igual que en
  // el flujo de "Comprar ahora" desde el ListingPage. Se usan los
  // métodos del PRIMARY listing (primer item del carrito); si productos
  // adicionales no soportan el método elegido, el server valida y
  // rechaza al iniciar la orden.
  const [primaryListing, setPrimaryListing] = useState(null);
  const [xoloSelectedMethod, setXoloSelectedMethod] = useState(null);

  const primaryListingId = cart?.items?.[0]?.listingId;
  useEffect(() => {
    if (!primaryListingId) return;
    const uuid = new UUID(primaryListingId);
    dispatch(showListing(uuid, config)).then(() => {
      dispatch((_, getState) => {
        const [l] = getListingsById(getState(), [uuid]);
        if (l) setPrimaryListing(l);
      });
    }).catch(() => {
      // silencioso — si no carga, el checkout intentará hidratarlo de nuevo
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [primaryListingId]);

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

  // XOLOLO Envíos v2: métodos del listing primario. Cuenta enabled > 0
  // dispara el selector.
  const xoloShippingMethods = primaryListing
    ? getShippingMethodsFromListing(primaryListing)
    : null;
  const xoloEnabledCount = xoloShippingMethods
    ? [
        xoloShippingMethods.pickup?.enabled,
        xoloShippingMethods.localDelivery?.enabled,
        xoloShippingMethods.skydropxCarrier?.enabled,
        xoloShippingMethods.freight?.enabled,
      ].filter(Boolean).length
    : 0;
  const showXoloMethodSelector = xoloEnabledCount > 0;
  const xoloDefaultMethod = xoloShippingMethods
    ? xoloShippingMethods.pickup?.enabled
      ? METHOD_PICKUP
      : xoloShippingMethods.localDelivery?.enabled
      ? METHOD_LOCAL_DELIVERY
      : xoloShippingMethods.skydropxCarrier?.enabled
      ? METHOD_SKYDROPX
      : xoloShippingMethods.freight?.enabled
      ? METHOD_FREIGHT
      : null
    : null;
  const xoloCurrencyFormatter = subunits => {
    const n = Number(subunits) || 0;
    if (n === 0) return 'Gratis';
    try {
      return formatMoney(intl, new Money(Math.round(n), currency));
    } catch (e) {
      return `$${(n / 100).toFixed(2)}`;
    }
  };
  // Buyer debe elegir método si el primary tiene v2 methods.
  const methodChosenOrDefault = xoloSelectedMethod || xoloDefaultMethod;
  const methodBlockingCheckout = showXoloMethodSelector && !methodChosenOrDefault;

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

            {/* XOLOLO Envíos v2: selector de método usando la config del
                listing primario. Si el primary tiene métodos v2, el
                buyer elige aquí; en el checkout ya viaja fijado. */}
            {showXoloMethodSelector ? (
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
                    Nota: el método se aplica a TODO el carrito. Si alguno
                    de los productos adicionales no soporta el método
                    elegido, el checkout te lo avisará al iniciar la orden.
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
                {showXoloMethodSelector
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
