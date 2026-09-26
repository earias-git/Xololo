import React, { useEffect, useState } from 'react';
import { useSelector } from 'react-redux';
import classNames from 'classnames';

import { selectAllCarts, selectCartHydrated } from '../../ducks/cart.duck';

import Menu from '../Menu/Menu';
import MenuLabel from '../MenuLabel/MenuLabel';
import MenuContent from '../MenuContent/MenuContent';
import MenuItem from '../MenuItem/MenuItem';
import NamedLink from '../NamedLink/NamedLink';

import css from './CartIndicator.module.css';

// XOLOLO Cart.C1: indicador de carrito para el topbar principal
// (xololo.mx). Muestra un ícono con badge = total de items en todos
// los carritos del usuario.
//
// Comportamiento:
//   - 0 carritos → no renderiza nada.
//   - 1 carrito  → link directo a /cart/:sellerId.
//   - 2+         → dropdown con un item por seller, listando conteo.
//
// SSR: durante el render en servidor los carritos vienen vacíos
// (localStorage no existe). Para evitar mismatch de hidratación con
// el cliente, esperamos a que se marque `mounted` en useEffect.
// Ver patrón similar en TopbarDesktop.js (`mounted` guard).
//
// Nota: la SellerBrandFrame ya tiene su propio indicador de carrito
// para el storefront (por-seller). Este componente vive en el topbar
// GLOBAL — se muestra al buyer fuera de una tienda concreta.

const CartIcon = props => {
  const { className } = props;
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="9" cy="21" r="1" />
      <circle cx="20" cy="21" r="1" />
      <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
    </svg>
  );
};

const totalItemsInCart = cart =>
  (cart?.items || []).reduce((sum, i) => sum + (Number(i.quantity) || 0), 0);

const CartIndicator = props => {
  const { className, rootClassName } = props;

  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  const hydrated = useSelector(selectCartHydrated);
  const allCarts = useSelector(selectAllCarts);

  // Antes de mount / hidratación no mostramos nada (evita mismatch SSR).
  if (!mounted || !hydrated) return null;

  const nonEmpty = allCarts.filter(c => (c?.items || []).length > 0);
  if (nonEmpty.length === 0) return null;

  const totalItems = nonEmpty.reduce((sum, c) => sum + totalItemsInCart(c), 0);
  const classes = classNames(rootClassName || css.root, className);

  // Un solo carrito → link directo.
  if (nonEmpty.length === 1) {
    const cart = nonEmpty[0];
    return (
      <NamedLink
        className={classes}
        name="CartPage"
        params={{ sellerId: cart.sellerId }}
        title={`Carrito · ${cart.sellerDisplayName || 'Tienda'}`}
      >
        <span className={css.iconWrap}>
          <CartIcon className={css.icon} />
          <span className={css.badge} aria-label={`${totalItems} items en tu carrito`}>
            {totalItems}
          </span>
        </span>
      </NamedLink>
    );
  }

  // Varios carritos → menú con un item por seller.
  return (
    <Menu>
      <MenuLabel className={classes} isOpenClassName={css.rootOpen} ariaLabel="Tus carritos">
        <span className={css.iconWrap}>
          <CartIcon className={css.icon} />
          <span className={css.badge} aria-label={`${totalItems} items en total`}>
            {totalItems}
          </span>
        </span>
      </MenuLabel>
      <MenuContent className={css.menuContent}>
        <MenuItem key="header">
          <div className={css.menuHeader}>
            Tus carritos ({nonEmpty.length} tiendas)
          </div>
        </MenuItem>
        {nonEmpty.map(cart => {
          const count = totalItemsInCart(cart);
          return (
            <MenuItem key={cart.sellerId}>
              <NamedLink
                className={css.menuLink}
                name="CartPage"
                params={{ sellerId: cart.sellerId }}
              >
                <span className={css.menuSellerName}>
                  {cart.sellerDisplayName || 'Tienda'}
                </span>
                <span className={css.menuCount}>
                  {count} {count === 1 ? 'artículo' : 'artículos'}
                </span>
              </NamedLink>
            </MenuItem>
          );
        })}
      </MenuContent>
    </Menu>
  );
};

export default CartIndicator;
