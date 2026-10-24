import React, { useState } from 'react';
import classNames from 'classnames';

import { FormattedMessage } from '../../../../util/reactIntl';
import { LISTING_STATE_DRAFT } from '../../../../util/types';
import {
  getAttributesForListing,
} from '../../../../config/listingAttributes';

import { H3, ListingLink } from '../../../../components';

import EditListingAttributesForm from './EditListingAttributesForm';
import css from './EditListingAttributesPanel.module.css';

// XOLOLO: panel del paso Atributos del wizard.
//
// Lee la categoría nivel 1 ya elegida (publicData.categoryLevel1 o el primer
// key que empiece con pub_categoryLevel/categoryLevel) + la sub-categoría
// persistida (publicData.subcategory). Alimenta el Form con esos valores +
// con publicData.attributes previos (si re-edita).
//
// Al submit:
//   publicData.subcategory = values.subcategory
//   publicData.attributes = { marca: 'Nike', talla: 'M', color: ['Negro', 'Blanco'], ... }
//   publicData.attributesVersion = 1 (migrations futuras)

// XOLOLO: busca el categoryLevel1 en publicData sin asumir nombre fijo.
// Sharetribe Console usa `categoryLevel1` por default pero puede cambiarse.
const findCategoryLevel1 = publicData => {
  if (!publicData) return null;
  if (publicData.categoryLevel1) return publicData.categoryLevel1;
  // Fallback: primer key que empiece con `categoryLevel` seguido de un dígito.
  for (const key of Object.keys(publicData)) {
    if (/^categoryLevel\d+$/.test(key) && publicData[key]) {
      return publicData[key];
    }
  }
  return null;
};

// Hidrata los valores del form desde publicData.attributes.
// Para dimensiones (objeto {h, w, d}), expande a 3 campos _h _w _d.
const buildInitialValues = publicData => {
  const subcategory = publicData?.subcategory || '';
  const persisted = publicData?.attributes || {};
  const flat = { subcategory };
  for (const [k, v] of Object.entries(persisted)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && ('h' in v || 'w' in v || 'd' in v)) {
      flat[`attr_${k}_h`] = v.h || '';
      flat[`attr_${k}_w`] = v.w || '';
      flat[`attr_${k}_d`] = v.d || '';
    } else {
      flat[`attr_${k}`] = v;
    }
  }
  return flat;
};

// Convierte los valores planos del form (attr_marca, attr_dimensiones_h,
// etc) al shape persistido publicData.attributes = {marca, dimensiones:{h,w,d}, ...}
// Sólo persiste los que tienen valor — los vacíos se omiten (legacy OK).
const buildPersistedAttributes = (values, categoryId, subcategoryId) => {
  const schema = getAttributesForListing(categoryId, subcategoryId);
  const out = {};
  for (const [key, def] of Object.entries(schema)) {
    const prefix = `attr_${key}`;
    if (def.type === 'dimensions') {
      const h = values[`${prefix}_h`];
      const w = values[`${prefix}_w`];
      const d = values[`${prefix}_d`];
      if (h || w || d) {
        out[key] = {
          h: h ? Number(h) : null,
          w: w ? Number(w) : null,
          d: d ? Number(d) : null,
          unit: def.unit || 'cm',
        };
      }
      continue;
    }
    const v = values[prefix];
    const isEmpty =
      v === undefined ||
      v === null ||
      v === '' ||
      (Array.isArray(v) && v.length === 0);
    if (isEmpty) continue;
    if (def.type === 'number') {
      out[key] = Number(v);
    } else if (def.type === 'boolean') {
      out[key] = v === true || v === 'true';
    } else {
      out[key] = v;
    }
  }
  return out;
};

const getInitialValues = props => {
  const publicData = props?.listing?.attributes?.publicData || {};
  return buildInitialValues(publicData);
};

const EditListingAttributesPanel = props => {
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

  const [state, setState] = useState({
    initialValues: getInitialValues(props),
  });
  const initialValues = state.initialValues;

  const classes = classNames(rootClassName || css.root, className);
  const publicData = listing?.attributes?.publicData || {};
  const categoryId = findCategoryLevel1(publicData);
  const isPublished = listing?.id && listing?.attributes?.state !== LISTING_STATE_DRAFT;

  if (!categoryId) {
    return (
      <main className={classes}>
        <H3 as="h1">
          <FormattedMessage
            id="EditListingAttributesPanel.noCategoryTitle"
            defaultMessage="Primero elige una categoría"
          />
        </H3>
        <p className={css.noCategoryNotice}>
          Para que podamos pedirte los atributos correctos, regresa al paso de
          Detalles y elige una categoría. Luego vuelve aquí.
        </p>
      </main>
    );
  }

  return (
    <main className={classes}>
      <H3 as="h1">
        {isPublished ? (
          <FormattedMessage
            id="EditListingAttributesPanel.title"
            defaultMessage="Características de {listingTitle}"
            values={{ listingTitle: <ListingLink listing={listing} /> }}
          />
        ) : (
          <FormattedMessage
            id="EditListingAttributesPanel.createListingTitle"
            defaultMessage="Agrega características específicas"
          />
        )}
      </H3>

      <EditListingAttributesForm
        className={css.form}
        formId="EditListingAttributesForm"
        initialValues={initialValues}
        categoryId={categoryId}
        onSubmit={values => {
          const subcategoryId = values.subcategory || null;
          const persistedAttributes = buildPersistedAttributes(
            values,
            categoryId,
            subcategoryId
          );
          const updateValues = {
            publicData: {
              subcategory: subcategoryId,
              attributes: persistedAttributes,
              attributesVersion: 1,
            },
          };
          // Preserva initialValues ante re-renders durante el submit XHR.
          setState({ initialValues: buildInitialValues({ ...publicData, ...updateValues.publicData }) });
          onSubmit(updateValues);
        }}
        saveActionMsg={submitButtonText}
        disabled={disabled}
        ready={ready}
        updated={panelUpdated}
        updateInProgress={updateInProgress}
        fetchErrors={errors}
      />
    </main>
  );
};

export default EditListingAttributesPanel;
