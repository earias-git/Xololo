import React, { useState } from 'react';
import classNames from 'classnames';

import { FormattedMessage } from '../../../../util/reactIntl';
import { LISTING_STATE_DRAFT } from '../../../../util/types';
import {
  getAttributesForListing,
  CATEGORY_TREE,
} from '../../../../config/listingAttributes';

import { H3, ListingLink } from '../../../../components';

import EditListingTextForm from './EditListingTextForm';
import css from './EditListingTextPanel.module.css';

// XOLOLO: paso final del wizard — Título + Descripción. Al llegar aquí
// el seller ya ingresó: categoría, fotos, atributos, precio y entrega.
// Es el último paso antes de publicar.
//
// En PR 4, la IA auto-dispara al mount con todo el contexto (atributos
// + fotos + categoría + precio) para pre-rellenar el título y la
// descripción. El seller edita o acepta.

// Construye un resumen legible del contexto para educar al seller sobre
// qué información tenemos. También sirve de debugging visible.
const buildContextSummary = publicData => {
  if (!publicData) return [];
  const lines = [];
  if (publicData.categoryLevel1) {
    const cat = CATEGORY_TREE[publicData.categoryLevel1];
    const catLabel = cat?.label || publicData.categoryLevel1;
    const sub = publicData.subcategory;
    const subLabel = sub && cat?.subcategories?.[sub] ? cat.subcategories[sub] : sub;
    lines.push(`Categoría: ${catLabel}${subLabel ? ` → ${subLabel}` : ''}`);
  }
  if (publicData.condition) {
    lines.push(`Condición: ${publicData.condition === 'used' ? 'Usado' : 'Nuevo'}`);
  }
  const attrs = publicData.attributes || {};
  const schema = getAttributesForListing(publicData.categoryLevel1, publicData.subcategory);
  const attrLines = [];
  for (const [key, val] of Object.entries(attrs)) {
    const def = schema[key];
    if (!def) continue;
    let valueStr = '';
    if (Array.isArray(val)) {
      valueStr = val.join(', ');
    } else if (typeof val === 'object' && val && 'h' in val) {
      const parts = [val.h, val.w, val.d].filter(Boolean).join(' × ');
      valueStr = parts ? `${parts} ${val.unit || 'cm'}` : '';
    } else if (typeof val === 'boolean') {
      valueStr = val ? 'Sí' : 'No';
    } else {
      valueStr = String(val);
    }
    if (valueStr) attrLines.push(`${def.label}: ${valueStr}`);
  }
  if (attrLines.length) lines.push(...attrLines);
  return lines;
};

const getInitialValues = props => {
  const l = props?.listing;
  return {
    title: l?.attributes?.title || '',
    description: l?.attributes?.description || '',
  };
};

const EditListingTextPanel = props => {
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
  const classes = classNames(rootClassName || css.root, className);
  const publicData = listing?.attributes?.publicData || {};
  const isPublished = listing?.id && listing?.attributes?.state !== LISTING_STATE_DRAFT;
  const contextSummary = buildContextSummary(publicData);

  return (
    <main className={classes}>
      <H3 as="h1">
        {isPublished ? (
          <FormattedMessage
            id="EditListingTextPanel.title"
            defaultMessage="Edita el texto de {listingTitle}"
            values={{ listingTitle: <ListingLink listing={listing} /> }}
          />
        ) : (
          <FormattedMessage
            id="EditListingTextPanel.createListingTitle"
            defaultMessage="Último paso: título y descripción"
          />
        )}
      </H3>
      <p className={css.lead}>
        Es el último paso antes de publicar. Ya cargaste fotos, características,
        precio y entrega — la IA puede sugerirte un título y una descripción
        atractivos basados en todo eso (próxima actualización). Mientras tanto
        edita a mano abajo.
      </p>

      <EditListingTextForm
        className={css.form}
        formId="EditListingTextForm"
        initialValues={state.initialValues}
        contextSummary={contextSummary}
        onSubmit={values => {
          const updateValues = {
            title: (values.title || '').trim(),
            description: (values.description || '').trim(),
          };
          setState({ initialValues: updateValues });
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

export default EditListingTextPanel;
