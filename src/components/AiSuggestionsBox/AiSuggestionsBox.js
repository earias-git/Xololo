import React, { useState } from 'react';
import classNames from 'classnames';

import { apiBaseUrl } from '../../util/api';

import css from './AiSuggestionsBox.module.css';

// XOLOLO Fase 2 — F2-13/F2-14. Botones de "sugerir con IA" para el
// seller en el editor del listing. Reusa publicData.aiAnalysis.tags que
// el pipeline de imagen ya extrajo, así que no gasta tokens de visión.
//
// Props:
//   listingId: uuid del listing (requerido). Si no hay (draft sin
//     guardar), muestra un hint deshabilitando los botones.
//   currentTitle: título actual en el form (se envía al endpoint como
//     contexto para que las sugerencias NO lo repitan tal cual).
//   currentDescription: descripción actual en el form.
//   onApplyTitle: (newTitle) => void — formApi.change('title', ...)
//   onApplyDescription: (newDesc) => void
//   onApplySeo: (seoObj) => void — opcional, por ahora no se persiste
//     en Sharetribe (sería meta tags). Si no se pasa, el bloque SEO se
//     muestra como "copiar al clipboard".
//   className: opcional

const api = async (path, body) => {
  const res = await fetch(`${apiBaseUrl()}${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
};

const AiSuggestionsBox = ({
  listingId,
  currentTitle,
  currentDescription,
  onApplyTitle,
  onApplyDescription,
  onApplySeo,
  className,
}) => {
  const [state, setState] = useState({
    loading: false,
    error: null,
    suggestions: null,
  });
  const [expanded, setExpanded] = useState(false);

  const canUse = !!listingId;

  const requestSuggestions = async () => {
    setState({ loading: true, error: null, suggestions: null });
    const r = await api('/api/ai/suggest-listing-text', {
      listingId,
      currentTitle,
      currentDescription,
    });
    if (!r.ok) {
      const code = r.data?.error;
      let userError;
      if (code === 'needs_analysis_first') {
        userError =
          'La IA todavía no ha analizado tus fotos. Guarda este paso, sube fotos y publica una primera vez; después vuelve aquí y recibirás sugerencias basadas en lo que las cámaras detectan.';
      } else if (code === 'unauthenticated') {
        userError = 'Tu sesión expiró. Recarga la página e intenta de nuevo.';
      } else if (code === 'not_your_listing') {
        userError = 'No puedes pedir sugerencias para un listing ajeno.';
      } else if (code === 'ai_not_configured') {
        userError = 'La IA está temporalmente deshabilitada. Intenta más tarde.';
      } else {
        userError = `Error: ${code || 'desconocido'}. Intenta de nuevo en un momento.`;
      }
      setState({ loading: false, error: userError, suggestions: null });
      return;
    }
    setState({ loading: false, error: null, suggestions: r.data });
    setExpanded(true);
  };

  if (!canUse) {
    return (
      <div className={classNames(css.root, css.disabledRoot, className)}>
        <div className={css.header}>
          <span className={css.sparkle}>✨</span>
          <h4 className={css.heading}>Sugerencias con IA</h4>
        </div>
        <p className={css.hint}>
          Guarda este paso una primera vez para activar las sugerencias
          automáticas basadas en tus fotos.
        </p>
      </div>
    );
  }

  const { loading, error, suggestions } = state;

  return (
    <div className={classNames(css.root, className)}>
      <div className={css.header}>
        <span className={css.sparkle}>✨</span>
        <h4 className={css.heading}>Sugerencias con IA</h4>
        {expanded && suggestions ? (
          <button
            type="button"
            className={css.collapse}
            onClick={() => setExpanded(false)}
          >
            Ocultar
          </button>
        ) : null}
      </div>

      {!expanded || !suggestions ? (
        <div className={css.intro}>
          <p className={css.hint}>
            Nuestra IA analizó tus fotos y puede sugerirte títulos, descripciones
            y metadata de SEO más efectivos.
          </p>
          <button
            type="button"
            className={css.primaryBtn}
            onClick={requestSuggestions}
            disabled={loading}
          >
            {loading ? 'Generando con IA…' : '✨ Mejorar con IA'}
          </button>
        </div>
      ) : null}

      {error ? <p className={css.error}>{error}</p> : null}

      {expanded && suggestions ? (
        <div className={css.suggestions}>
          {/* Títulos */}
          <section className={css.section}>
            <h5 className={css.sectionTitle}>Opciones de título</h5>
            <ul className={css.list}>
              {(suggestions.titleSuggestions || []).map((t, i) => (
                <li key={`t-${i}`} className={css.item}>
                  <span className={css.itemText}>{t}</span>
                  <button
                    type="button"
                    className={css.useBtn}
                    onClick={() => onApplyTitle && onApplyTitle(t)}
                  >
                    Usar
                  </button>
                </li>
              ))}
            </ul>
          </section>

          {/* Descripciones */}
          <section className={css.section}>
            <h5 className={css.sectionTitle}>Opciones de descripción</h5>
            <ul className={css.list}>
              {(suggestions.descriptionSuggestions || []).map((d, i) => (
                <li key={`d-${i}`} className={css.item}>
                  <span className={css.itemTextMulti}>{d}</span>
                  <button
                    type="button"
                    className={css.useBtn}
                    onClick={() => onApplyDescription && onApplyDescription(d)}
                  >
                    Usar
                  </button>
                </li>
              ))}
            </ul>
          </section>

          {/* SEO */}
          {suggestions.seo ? (
            <section className={css.section}>
              <h5 className={css.sectionTitle}>SEO sugerido</h5>
              <dl className={css.seoList}>
                <dt>Slug URL</dt>
                <dd className={css.mono}>{suggestions.seo.slug}</dd>
                <dt>Meta title</dt>
                <dd>{suggestions.seo.metaTitle}</dd>
                <dt>Meta description</dt>
                <dd>{suggestions.seo.metaDescription}</dd>
                <dt>Keywords principales</dt>
                <dd>{(suggestions.seo.keywordsPrimary || []).join(' · ')}</dd>
                <dt>Keywords long-tail</dt>
                <dd>{(suggestions.seo.keywordsLong || []).join(' · ')}</dd>
              </dl>
              <p className={css.footnote}>
                Estos datos se usarán automáticamente para mejorar tu
                posicionamiento en Google. No tienes que copiarlos.
              </p>
            </section>
          ) : null}

          <div className={css.refreshRow}>
            <button
              type="button"
              className={css.secondaryBtn}
              onClick={requestSuggestions}
              disabled={loading}
            >
              {loading ? 'Generando…' : '↻ Regenerar sugerencias'}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default AiSuggestionsBox;
