import React, { useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import classNames from 'classnames';

import { addToCart, selectCartItemCount, selectCartForSeller } from '../../ducks/cart.duck';

import css from './AddToCartCta.module.css';

// XOLOLO: componente que agrega un listing al carrito del seller.
// Cart.2 (v1). Muestra:
//   - Selector de cantidad (- N +)
//   - Botón "Agregar al carrito" con feedback "✓ Agregado" al hacer click
//   - Contador flotante "Ya tienes N items del vendedor" si el carrito
//     ya tiene otros items del mismo seller (para incentivar consolidar)
//
// Props:
//   listing: object con id.uuid, attributes.title, attributes.price,
//            relationships.author (con seller.attributes.profile.displayName,
//            publicData.slug)
//   author: el user seller (redundante con listing.author pero
//            el shape difiere entre ListingPage y otros contextos)
//   imageUrl: URL de la primera imagen del listing (opcional)
//   className, rootClassName: opcional para override de estilos

const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

const AddToCartCta = ({ listing, author, imageUrl, className, rootClassName }) => {
  const dispatch = useDispatch();
  const [quantity, setQuantity] = useState(1);
  const [justAdded, setJustAdded] = useState(false);

  const sellerId = author?.id?.uuid || listing?.relationships?.author?.data?.id?.uuid;
  const sellerDisplayName = author?.attributes?.profile?.displayName;
  const sellerSlug = author?.attributes?.profile?.publicData?.slug;
  const currentCount = useSelector(sellerId ? selectCartItemCount(sellerId) : () => 0);
  const currentCart = useSelector(sellerId ? selectCartForSeller(sellerId) : () => null);
  const alreadyInCart = currentCart?.items?.some(
    i => i.listingId === listing?.id?.uuid
  );

  if (!listing || !sellerId) return null;

  const price = listing.attributes?.price;
  const priceMoney = price?.amount != null
    ? { amount: Number(price.amount), currency: price.currency || 'MXN' }
    : null;

  const handleAdd = () => {
    dispatch(
      addToCart({
        sellerId,
        sellerDisplayName,
        sellerSlug,
        item: {
          listingId: listing.id.uuid,
          listingTitle: listing.attributes?.title || 'Producto',
          listingImageUrl: imageUrl || null,
          price: priceMoney,
          quantity,
        },
      })
    );
    setJustAdded(true);
    setTimeout(() => setJustAdded(false), 2500);
  };

  return (
    <div className={classNames(rootClassName || css.root, className)}>
      <div className={css.header}>
        <h4 className={css.title}>¿Quieres agregarlo al carrito?</h4>
        <p className={css.subtitle}>
          Consolida varios productos de esta tienda en un solo envío para
          ahorrar en paquetería.
        </p>
      </div>

      <div className={css.controls}>
        <div className={css.qtyGroup}>
          <button
            type="button"
            className={css.qtyBtn}
            onClick={() => setQuantity(q => clamp(q - 1, 1, 99))}
            aria-label="Menos"
          >
            −
          </button>
          <input
            type="number"
            className={css.qtyInput}
            value={quantity}
            min={1}
            max={99}
            onChange={e => setQuantity(clamp(Number.parseInt(e.target.value, 10) || 1, 1, 99))}
          />
          <button
            type="button"
            className={css.qtyBtn}
            onClick={() => setQuantity(q => clamp(q + 1, 1, 99))}
            aria-label="Más"
          >
            +
          </button>
        </div>
        <button
          type="button"
          className={classNames(css.addBtn, { [css.addBtnAdded]: justAdded })}
          onClick={handleAdd}
        >
          {justAdded ? '✓ Agregado' : '🛒 Agregar al carrito'}
        </button>
      </div>

      {alreadyInCart ? (
        <p className={css.hint}>
          Este producto ya está en tu carrito ({currentCount} items en total). Al
          agregar otra vez, aumentaremos la cantidad.
        </p>
      ) : currentCount > 0 ? (
        <p className={css.hint}>
          Ya tienes <strong>{currentCount}</strong> items de esta tienda en tu
          carrito.
        </p>
      ) : null}

      {currentCount > 0 ? (
        <a href={`/cart/${sellerId}`} className={css.viewCartLink}>
          🛒 Ver mi carrito ({currentCount}) →
        </a>
      ) : null}
    </div>
  );
};

export default AddToCartCta;
