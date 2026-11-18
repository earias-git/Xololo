import React, { useState } from 'react';
import classNames from 'classnames';

import { FormattedMessage } from '../../../../util/reactIntl';
import { LISTING_STATE_DRAFT } from '../../../../util/types';
import { listAttributes } from '../../../../config/listingAttributes';
import {
  generateVariantGroupId,
  getVariantGroupId,
  isVariantMaster,
  getVariantAxes,
  getVariantValues,
  // XOLOLO LOCKED — ADR-003 Foto por color (Fase 2)
  isFashionCategory,
  slugifyAxisValue,
  pruneDanglingColorImages,
} from '../../../../util/variants';

import { H3, ListingLink } from '../../../../components';

import EditListingVariantsForm from './EditListingVariantsForm';
import css from './EditListingVariantsPanel.module.css';

// XOLOLO (Variantes · PR 2) — Panel del tab Variantes del wizard.
//
// Visible solo para tier Enterprise (gate aplicado en EditListingWizard.js
// al construir el orden de tabs).
//
// Lee la subcategoría ya elegida (publicData.subcategory) + el estado
// actual de variantes (publicData.variantGroupId, variantAxes,
// variantValues, variantsMatrix staging) para hidratar el form.
//
// Al submit, delega en onSubmit({ enabled, axes, rows }) — el duck
// (onSaveVariants) decide si crear/actualizar hermanos. En este PR 2
// guardamos el intent del seller en publicData.variantsMatrix del master
// como staging; el spawn real de siblings se cierra en el mismo duck
// (ver EditListingPage.duck.js).

const SELECT_LIKE_TYPES = new Set(['select', 'multiselect']);

const findCategoryLevel1 = publicData => {
  if (!publicData) return null;
  if (publicData.categoryLevel1) return publicData.categoryLevel1;
  for (const key of Object.keys(publicData)) {
    if (/^categoryLevel\d+$/.test(key) && publicData[key]) return publicData[key];
  }
  return null;
};

// Hidrata el form a partir del master.
// Si el master ya es master de un grupo (isVariantMaster=true + variantGroupId),
// reconstruye axes + valuesByAxis + rowData desde publicData.variantsMatrix.
// XOLOLO ADR-003: también hidrata colorImagesMap desde
// publicData.variantValueImages.color para que el seller vea las fotos
// previamente guardadas al reabrir el wizard.
const buildInitialValues = listing => {
  const publicData = listing?.attributes?.publicData || {};
  const colorImagesMap = publicData.variantValueImages?.color || {};
  const alreadyGroup = isVariantMaster(listing) && !!getVariantGroupId(listing);
  if (!alreadyGroup) {
    return { enabled: false, axes: [], valuesByAxis: {}, rowData: {}, colorImagesMap };
  }
  const axes = getVariantAxes(listing);
  const matrix = Array.isArray(publicData.variantsMatrix) ? publicData.variantsMatrix : [];
  const valuesByAxis = {};
  const rowData = {};
  for (const row of matrix) {
    const vv = row.variantValues || {};
    for (const ax of axes) {
      const v = vv[ax];
      if (v == null) continue;
      valuesByAxis[ax] = valuesByAxis[ax] || [];
      if (!valuesByAxis[ax].includes(v)) valuesByAxis[ax].push(v);
    }
    const key = axes.map(ax => vv[ax]).join('||');
    rowData[key] = {
      stock: row.stock ?? '',
      price: row.priceOverride ?? '',
    };
  }
  return { enabled: true, axes, valuesByAxis, rowData, colorImagesMap };
};

// XOLOLO LOCKED — ADR-003: feature flag para "Foto por color".
// Lee en tiempo de render (no en module scope) para que el test runner
// pueda overridearlo si lo necesita.
const isColorImagesFeatureOn = () =>
  process.env.REACT_APP_FEATURE_VARIANT_COLOR_IMAGES === 'true';

const EditListingVariantsPanel = props => {
  const {
    className,
    rootClassName,
    listing,
    disabled,
    ready,
    onSubmit,
    submitButtonText,
    panelUpdated,
    updateInProgress,
    errors,
    // XOLOLO ADR-003: upload de foto por color (Fase 2).
    // Opcionales; si no llegan, el form no renderiza slots.
    images,
    onImageUpload,
    onRemoveImage,
  } = props;

  const publicData = listing?.attributes?.publicData || {};
  const categoryId = findCategoryLevel1(publicData);
  const subcategoryId = publicData.subcategory || null;
  const isEvent = publicData?.isEvent === true;
  const isPublished = listing?.id && listing?.attributes?.state !== LISTING_STATE_DRAFT;

  const [initialValues] = useState(() => buildInitialValues(listing));

  // Atributos elegibles como ejes: los `select` de la (sub)categoría.
  // Excluye los que solo tienen 1 opción posible (no tiene sentido).
  const selectAttrs = (listAttributes(categoryId, subcategoryId, isEvent) || []).filter(
    a => SELECT_LIKE_TYPES.has(a.type) && (a.options || []).length >= 2
  );

  const classes = classNames(rootClassName || css.root, className);

  const handleSubmit = form => {
    // Form envía: { enabled: boolean, axes?, rows? }
    if (!form.enabled) {
      // Desactivar: limpia variant fields del master. Los siblings (si
      // los hubiera) NO se cierran aquí — eso es decisión del duck en
      // una iteración futura; por ahora simplemente dejamos el master
      // en estado "no es grupo".
      onSubmit({
        publicData: {
          variantGroupId: null,
          isVariantMaster: false,
          variantAxes: null,
          variantValues: null,
          variantsMatrix: null,
        },
      });
      return;
    }

    // Activar/actualizar grupo:
    const existingGroupId = getVariantGroupId(listing);
    const groupId = existingGroupId || generateVariantGroupId();
    const axes = form.axes;
    const rows = form.rows || [];

    // XOLOLO 2026-11-10: el master NO es una variante — es el producto
    // canónico. Sus variantValues vienen del paso Atributos (talla,
    // color que el seller capturó al crear el listing), NO de la primera
    // fila del matrix. Las filas del matrix son SIBLINGS adicionales.
    //
    // Si un atributo es array (multiselect), tomamos el primer valor.
    // Si el atributo no existe aún, queda undefined (se recomienda al
    // seller completar el paso Atributos antes de activar variantes).
    const masterAttrs = publicData?.attributes || {};
    const normalizeAttrValue = v => (Array.isArray(v) ? v[0] : v);
    const masterValues = {};
    for (const ax of axes) {
      const v = normalizeAttrValue(masterAttrs[ax]);
      if (v != null && v !== '') masterValues[ax] = v;
    }

    // XOLOLO LOCKED — ADR-003: incluir variantValueImages del eje color.
    // Sólo escribe al master (este listing). Zero propagación a siblings.
    // El form entrega form.colorImagesMap sincronizado con los uploads.
    let variantValueImages;
    const flagOn = isColorImagesFeatureOn();
    const fashion = isFashionCategory(listing);
    const colorValuesCurrent = (valuesByAxis => {
      const v = valuesByAxis?.color;
      return Array.isArray(v) ? v : [];
    })(form.valuesByAxis);
    if (flagOn && fashion && axes.includes('color')) {
      const rawMap = form.colorImagesMap || {};
      // Construir el mapa final con slugs normalizados.
      const colorMap = {};
      for (const [k, v] of Object.entries(rawMap)) {
        if (typeof v === 'string' && v.length > 0) {
          const slug = slugifyAxisValue(k);
          if (slug) colorMap[slug] = v;
        }
      }
      // Purgar slugs que ya no están entre los valores seleccionados.
      const purged = pruneDanglingColorImages(
        { variantValueImages: { color: colorMap } },
        colorValuesCurrent
      );
      variantValueImages = purged.variantValueImages || null;
    }

    const updateValues = {
      publicData: {
        variantGroupId: groupId,
        isVariantMaster: true,
        variantAxes: axes,
        variantValues: masterValues,
        variantsMatrix: rows,
        // Solo setear si el feature aplica; si quedó null, lo limpia.
        ...(flagOn && fashion && axes.includes('color')
          ? { variantValueImages: variantValueImages || null }
          : {}),
      },
      // XOLOLO LOCKED — ADR-003: si subimos fotos por color al master,
      // incluimos `images` en el update para que Sharetribe las deje
      // attachadas (si no, quedan huérfanas y Sharetribe las descarta).
      // El `images` prop viene del WizardTab y ya contiene las
      // originales del master + las nuevas del wizard.
      ...(flagOn && fashion && axes.includes('color') && Array.isArray(images)
        ? { images }
        : {}),
    };
    onSubmit(updateValues);
  };

  if (!categoryId) {
    return (
      <main className={classes}>
        <H3 as="h1">
          <FormattedMessage
            id="EditListingVariantsPanel.noCategoryTitle"
            defaultMessage="Primero elige una categoría"
          />
        </H3>
        <p>
          Regresa al paso Detalles y elige una categoría + subcategoría antes de configurar
          variantes.
        </p>
      </main>
    );
  }

  return (
    <main className={classes}>
      <H3 as="h1">
        {isPublished ? (
          <FormattedMessage
            id="EditListingVariantsPanel.title"
            defaultMessage="Variantes de {listingTitle}"
            values={{ listingTitle: <ListingLink listing={listing} /> }}
          />
        ) : (
          <FormattedMessage
            id="EditListingVariantsPanel.createTitle"
            defaultMessage="¿Vendes este producto en varias tallas o colores?"
          />
        )}
      </H3>

      <EditListingVariantsForm
        initialValues={initialValues}
        selectAttrs={selectAttrs}
        onSubmit={handleSubmit}
        submitButtonText={submitButtonText}
        disabled={disabled}
        ready={ready}
        updated={panelUpdated}
        updateInProgress={updateInProgress}
        fetchErrors={errors}
        // XOLOLO ADR-003 Fase 2
        enableColorImages={isColorImagesFeatureOn() && isFashionCategory(listing)}
        images={images}
        onImageUpload={onImageUpload}
        onRemoveImage={onRemoveImage}
        /* XOLOLO LOCKED — ADR-004 Fase 4: valores del master
           (talla + color + lo que aplique) para marcar su fila
           en el matrix con el badge "Principal". */
        masterVariantValues={getVariantValues(listing)}
      />
    </main>
  );
};

export default EditListingVariantsPanel;
