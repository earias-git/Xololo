import React, { useCallback, useEffect, useRef, useState } from 'react';
import classNames from 'classnames';

import { FormattedMessage } from '../../../../util/reactIntl';
import { LISTING_STATE_DRAFT } from '../../../../util/types';
import {
  getAttributesForListing,
  CATEGORY_TREE,
} from '../../../../config/listingAttributes';
import { apiBaseUrl } from '../../../../util/api';

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

// XOLOLO: dispara análisis de imagen si aún no corrió (sincrono: false
// para esperar los tags). Idempotente — el server devuelve lo cached si
// ya existe aiAnalysis en el listing.
const runImageAnalysis = async listingId => {
  try {
    await fetch(`${apiBaseUrl()}/api/ai/analyze-listing`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ listingId, async: false }),
    });
  } catch (_) {
    // Fail-open — si falla, la sugerencia de texto corre sin tags y
    // genera con lo que haya (atributos + categoría).
  }
};

// XOLOLO: llama al endpoint de sugerencias y devuelve
// {titleSuggestions, descriptionSuggestions, seo} o null si falla.
const fetchAiSuggestions = async ({ listingId, currentTitle, currentDescription, attributesSchema }) => {
  try {
    const res = await fetch(`${apiBaseUrl()}/api/ai/suggest-listing-text`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ listingId, currentTitle, currentDescription, attributesSchema }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return { ok: false, error: err?.error || `http_${res.status}` };
    }
    const data = await res.json();
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: e?.message || 'network' };
  }
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
  const [ai, setAi] = useState({
    loading: false,
    settled: false,
    suggestions: null,
    error: null,
  });

  // XOLOLO: recomendaciones sobre las fotos del listing. Vienen de la
  // IA visual que ya corrió (publicData.aiAnalysis.aggregated.recommendations).
  // Las mostramos al seller como consejos accionables antes de publicar.
  const photoRecommendations =
    listing?.attributes?.publicData?.aiAnalysis?.aggregated?.recommendations || null;
  // Guard contra doble-dispatch del auto-trigger al mount (ej. strict mode).
  const autoTriggeredRef = useRef(false);

  const classes = classNames(rootClassName || css.root, className);
  const publicData = listing?.attributes?.publicData || {};
  const isPublished = listing?.id && listing?.attributes?.state !== LISTING_STATE_DRAFT;
  const contextSummary = buildContextSummary(publicData);

  // Schema de atributos — se pasa al endpoint para que la IA sepa el label
  // humano de cada key.
  const attributesSchema = getAttributesForListing(
    publicData.categoryLevel1,
    publicData.subcategory
  );

  // Chequea si el listing ya tiene aiAnalysis.aggregated.tags.
  // El pipeline de visión corre al subir fotos pero no siempre está hidratado
  // en este estado; para asegurar que la IA de texto tenga tags, lo
  // disparamos on-demand sincrono si falta.
  const hasVisualAnalysis =
    !!listing?.attributes?.publicData?.aiAnalysis?.aggregated?.tags;

  const runAi = useCallback(async () => {
    if (!listing?.id?.uuid) return;
    setAi({ loading: true, settled: false, suggestions: null, error: null });
    // Si no hay tags de visión, los generamos primero. Esto hace que la
    // IA de texto pueda describir elementos VISUALES del flyer/foto que
    // el seller no mencionó en atributos. ~5-10s extra.
    if (!hasVisualAnalysis) {
      await runImageAnalysis(listing.id.uuid);
    }
    const result = await fetchAiSuggestions({
      listingId: listing.id.uuid,
      currentTitle: state.initialValues.title,
      currentDescription: state.initialValues.description,
      attributesSchema,
    });
    if (result.ok) {
      setAi({ loading: false, settled: true, suggestions: result.data, error: null });
    } else {
      setAi({ loading: false, settled: true, suggestions: null, error: result.error });
    }
  }, [listing?.id?.uuid, state.initialValues.title, state.initialValues.description, attributesSchema, hasVisualAnalysis]);

  // XOLOLO: auto-trigger al mount SI (a) hay listing, (b) la descripción
  // está vacía o es muy corta (<30 chars = probablemente placeholder de
  // Details). Esto es el core del PR 4 — el seller llega al step Text y
  // en 2-3s ve 3 opciones listas. Si prefiere escribir él, ignora.
  useEffect(() => {
    if (autoTriggeredRef.current) return;
    const d = state.initialValues.description || '';
    const isEmptyOrShort = d.trim().length < 30;
    if (listing?.id?.uuid && isEmptyOrShort) {
      autoTriggeredRef.current = true;
      runAi();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listing?.id?.uuid]);

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
        photoRecommendations={photoRecommendations}
        aiState={ai}
        onRegenerateAi={runAi}
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
