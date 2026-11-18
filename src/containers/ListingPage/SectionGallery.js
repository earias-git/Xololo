import React from 'react';
import ListingImageGallery from './ListingImageGallery/ListingImageGallery';

import css from './ListingPage.module.css';

// XOLOLO LOCKED — ADR-003 Fase 3: prepend una imagen externa (del
// master) al frente de la galería del sibling. Si la imagen ya está
// en el array del sibling por su id, la movemos al frente en vez de
// duplicar. Si no está, la insertamos. Zero mutación del prop.
const prependExternalImage = (images, externalImage) => {
  const base = Array.isArray(images) ? images : [];
  if (!externalImage) return base;
  const extId = externalImage?.id?.uuid || externalImage?.id;
  if (!extId) return base;
  const idx = base.findIndex(img => {
    const uuid = img?.id?.uuid || img?.id;
    return uuid === extId;
  });
  if (idx === 0) return base;
  if (idx > 0) {
    const next = base.slice();
    const [picked] = next.splice(idx, 1);
    next.unshift(picked);
    return next;
  }
  return [externalImage, ...base];
};

const SectionGallery = props => {
  const { listing, variantPrefix, prependImage } = props;
  const images = prependExternalImage(listing.images, prependImage);
  const imageVariants = ['scaled-small', 'scaled-medium', 'scaled-large', 'scaled-xlarge'];
  const thumbnailVariants = [variantPrefix, `${variantPrefix}-2x`, `${variantPrefix}-4x`];
  return (
    <section className={css.productGallery} data-testid="carousel">
      <ListingImageGallery
        images={images}
        imageVariants={imageVariants}
        thumbnailVariants={thumbnailVariants}
      />
    </section>
  );
};

export default SectionGallery;
