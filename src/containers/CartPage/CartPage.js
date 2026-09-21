import React, { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';

import { apiBaseUrl } from '../../util/api';
import { formatMoney } from '../../util/currency';
import { useIntl } from '../../util/reactIntl';
import { useConfiguration } from '../../context/configurationContext';
import { types as sdkTypes } from '../../util/sdkLoader';
import { isScrollingDisabled } from '../../ducks/ui.duck';
import {
  selectCartForSeller,
  selectCartHydrated,
  updateQuantity,
  removeItem,
  clearSellerCart,
} from '../../ducks/cart.duck';

import { LayoutSingleColumn, Page, SellerBrandFrame } from '../../components';
import TopbarContainer from '../TopbarContainer/TopbarContainer';
import FooterContainer from '../FooterContainer/FooterContainer';

import css from './CartPage.module.css';

const { Money } = sdkTypes;

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
  const intl = useIntl();
  const dispatch = useDispatch();
  const params = props?.params || {};
  const sellerId = params.sellerId;

  const scrollingDisabled = useSelector(isScrollingDisabled);
  const hydrated = useSelector(selectCartHydrated);
  const cart = useSelector(sellerId ? selectCartForSeller(sellerId) : () => null);
  const [redirecting, setRedirecting] = useState(false);

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
    // Cart.5: el server acepta un checkout multi-item; por ahora hacemos
    // un placeholder que redirige al listing del primer item (checkout
    // single) para no bloquear el flow del buyer. Cuando Cart.5 esté
    // listo, cambiamos por POST /api/checkout-cart {sellerId} que crea
    // una tx con multi-item.
    setRedirecting(true);
    const first = cart.items[0];
    // Redirect al listing del primer item — el buyer completa checkout
    // individual mientras terminamos Cart.5.
    window.location.href = `/l/product/${first.listingId}/checkout`;
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

            <div className={css.summary}>
              <div className={css.summaryRow}>
                <span>Subtotal ({totalItems} items)</span>
                <strong>{formatMoney(intl, subtotalMoney)}</strong>
              </div>
              <p className={css.summaryHint}>
                Al ir a checkout eliges paquetería + capturas dirección de envío.
                El costo final incluye tu envío ya cotizado.
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
                  disabled={redirecting}
                >
                  {redirecting ? 'Un momento…' : 'Ir a checkout →'}
                </button>
              </div>
              <p className={css.pendingHint}>
                <strong>Nota v1:</strong> el checkout multi-item se completa en
                Cart.5 (próximo commit). Por ahora "Ir a checkout" te lleva al
                primer producto para pagarlo individualmente. Los demás items
                quedan en el carrito para siguientes compras.
              </p>
            </div>
          </main>
        </LayoutSingleColumn>
      </SellerBrandFrame>
    </Page>
  );
};

export default CartPage;
