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
const buildInitialValues = listing => {
  const publicData = listing?.attributes?.publicData || {};
  const alreadyGroup = isVariantMaster(listing) && !!getVariantGroupId(listing);
  if (!alreadyGroup) {
    return { enabled: false, axes: [], valuesByAxis: {}, rowData: {} };
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
  return { enabled: true, axes, valuesByAxis, rowData };
};

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

    // El master toma los variantValues de la PRIMERA fila (convención).
    const firstRow = rows[0];
    const masterValues = firstRow ? firstRow.variantValues : {};

    const updateValues = {
      publicData: {
        variantGroupId: groupId,
        isVariantMaster: true,
        variantAxes: axes,
        variantValues: masterValues,
        variantsMatrix: rows,
      },
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
      />
    </main>
  );
};

export default EditListingVariantsPanel;
