import React from 'react';
import classNames from 'classnames';

import { AspectRatioWrapper, AvatarMedium, ResponsiveImage } from '../../components';

import css from './CheckoutPage.module.css';

const MobileListingImage = props => {
  const {
    listingTitle,
    author,
    firstImage,
    layoutListingImageConfig,
    showListingImage,
    // XOLOLO Cart.C2-foto: items adicionales para mostrar debajo de la
    // imagen principal en mobile (mismo shape que en DetailsSideCard).
    additionalItems = [],
  } = props;

  const { aspectWidth = 1, aspectHeight = 1, variantPrefix = 'listing-card' } =
    layoutListingImageConfig || {};
  const variants = firstImage
    ? Object.keys(firstImage?.attributes?.variants).filter(k => k.startsWith(variantPrefix))
    : [];

  return (
    <>
      {showListingImage && (
        <AspectRatioWrapper
          width={aspectWidth}
          height={aspectHeight}
          className={css.listingImageMobile}
        >
          <ResponsiveImage
            rootClassName={css.rootForImage}
            alt={listingTitle}
            image={firstImage}
            variants={variants}
          />
        </AspectRatioWrapper>
      )}
      <div
        className={classNames(css.avatarWrapper, css.avatarMobile, {
          [css.noListingImage]: !showListingImage,
        })}
      >
        <AvatarMedium user={author} disableProfileLink />
      </div>
      {additionalItems.length > 0 ? (
        <ul className={css.additionalItemsList} aria-label="Productos adicionales en tu pedido">
          {additionalItems.map((it, idx) => (
            <li key={`extra-m-${idx}`} className={css.additionalItem}>
              <div className={css.additionalItemThumb}>
                {it.imageUrl ? (
                  <img src={it.imageUrl} alt={it.title || 'Producto'} />
                ) : (
                  <div className={css.additionalItemThumbEmpty}>📦</div>
                )}
              </div>
              <div className={css.additionalItemMain}>
                <span className={css.additionalItemTitle}>
                  {it.title || 'Producto'}
                </span>
                <span className={css.additionalItemQty}>
                  Cantidad: {it.quantity}
                </span>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
};

export default MobileListingImage;
