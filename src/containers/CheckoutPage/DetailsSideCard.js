import React from 'react';
import classNames from 'classnames';

import { FormattedMessage } from '../../util/reactIntl';
import { propTypes } from '../../util/types';
import { createSlug } from '../../util/urlHelpers';
import { formatMoney } from '../../util/currency';

import {
  AspectRatioWrapper,
  AvatarMedium,
  H4,
  H6,
  NamedLink,
  ResponsiveImage,
} from '../../components';

import css from './CheckoutPage.module.css';

/**
 * A card that displays the listing and booking details on the checkout page.
 *
 * @component
 * @param {Object} props
 * @param {propTypes.listing} props.listing - The listing
 * @param {string} props.listingTitle - The listing title
 * @param {propTypes.user} props.author - The author
 * @param {propTypes.image} props.firstImage - The first image
 * @param {Object} props.layoutListingImageConfig - The layout listing image config
 * @param {ReactNode} props.speculateTransactionErrorMessage - The speculate transaction error message
 * @param {boolean} props.showPrice - Whether to show the price
 * @param {string} props.processName - The process name
 * @param {ReactNode} props.breakdown - The breakdown
 * @param {intlShape} props.intl - The intl object
 */
const DetailsSideCard = props => {
  const {
    listing,
    listingTitle,
    priceVariantName,
    author,
    firstImage,
    layoutListingImageConfig,
    speculateTransactionErrorMessage,
    showPrice,
    processName,
    breakdown,
    showListingImage,
    intl,
    // XOLOLO Cart.C2-foto: items adicionales del carrito. Cada uno:
    // { title, imageUrl, quantity }. Cuando hay al menos uno, la
    // sidebar cambia a modo "resumen multi-item": el primary sigue
    // siendo la imagen grande, y debajo listamos miniaturas de los
    // demás para que el buyer confirme visualmente qué está pagando.
    additionalItems = [],
  } = props;

  const { price, publicData } = listing?.attributes || {};
  const unitType = publicData.unitType || 'unknown';

  const { aspectWidth = 1, aspectHeight = 1, variantPrefix = 'listing-card' } =
    layoutListingImageConfig || {};
  const variants = firstImage
    ? Object.keys(firstImage?.attributes?.variants).filter(k => k.startsWith(variantPrefix))
    : [];

  return (
    <div className={css.detailsContainerDesktop} role="complementary">
      {showListingImage && (
        <AspectRatioWrapper
          width={aspectWidth}
          height={aspectHeight}
          className={css.detailsAspectWrapper}
        >
          <ResponsiveImage
            rootClassName={css.rootForImage}
            alt={listingTitle}
            image={firstImage}
            variants={variants}
          />
        </AspectRatioWrapper>
      )}
      <div className={css.listingDetailsWrapper}>
        <div className={classNames(css.avatarWrapper, { [css.noListingImage]: !showListingImage })}>
          <AvatarMedium user={author} disableProfileLink />
        </div>
        <div
          className={classNames(css.detailsHeadings, { [css.noListingImage]: !showListingImage })}
        >
          <H4 as="h2">
            <NamedLink
              name="ListingPage"
              params={{ id: listing?.id?.uuid, slug: createSlug(listingTitle) }}
            >
              {listingTitle}
            </NamedLink>
          </H4>
          {showPrice ? (
            <div className={css.priceContainer}>
              <p className={css.price}>{formatMoney(intl, price)}</p>
              <div className={css.perUnit}>
                <FormattedMessage
                  id="CheckoutPageWithInquiryProcess.perUnit"
                  values={{ unitType }}
                />
              </div>
            </div>
          ) : null}
        </div>
        {speculateTransactionErrorMessage}
      </div>

      {additionalItems.length > 0 ? (
        <ul className={css.additionalItemsList} aria-label="Productos adicionales en tu pedido">
          {additionalItems.map((it, idx) => (
            <li key={`extra-${idx}`} className={css.additionalItem}>
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

      {!!breakdown ? (
        <div className={css.orderBreakdownHeader}>
          {priceVariantName ? (
            <div className={css.bookingPriceVariant}>
              <p>{priceVariantName}</p>
            </div>
          ) : null}

          <H6 as="h3" className={css.orderBreakdownTitle}>
            <FormattedMessage id={`CheckoutPage.${processName}.orderBreakdown`} />
          </H6>
          <hr className={css.totalDivider} />
        </div>
      ) : null}
      {breakdown}
    </div>
  );
};

export default DetailsSideCard;
