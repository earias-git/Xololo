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
  const { listing, variantPrefix, prependImage, fallbackImages } = props;
  // XOLOLO LOCKED — ADR-004 Fase 3: si el listing (sibling) no tiene
  // imágenes propias, usar las del master como base. Zero write —
  // solo lectura. El master vive en el store gracias a
  // fetchVariantSiblings (ADR-003 Fase 3).
  const baseImages =
    Array.isArray(listing.images) && listing.images.length > 0
      ? listing.images
      : Array.isArray(fallbackImages)
      ? fallbackImages
      : listing.images;
  const images = prependExternalImage(baseImages, prependImage);
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
