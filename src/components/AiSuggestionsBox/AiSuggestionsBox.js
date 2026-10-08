import React, { useState, useEffect, useRef } from 'react';
import classNames from 'classnames';
import { useLocation } from 'react-router-dom';

import { apiBaseUrl } from '../../util/api';

import css from './AiSuggestionsBox.module.css';

// XOLOLO Fase 2 — F2-13/F2-14. Botones de "sugerir con IA" para el
// seller en el editor del listing. Reusa publicData.aiAnalysis.tags que
// el pipeline de imagen ya extrajo, así que no gasta tokens de visión.
//
// Flujo de guiado del wizard (sub-commit 5):
//   - Primera visita a Detalles (sin fotos aún): bloque muestra hint
//     "Guarda este paso y sube fotos; después vuelve aquí".
//   - En Fotos aparece un CTA "✨ Mejora tu texto con IA" que navega
//     de vuelta a Detalles con ?autoSuggest=1.
//   - Al llegar con autoSuggest=1: dispara análisis sync (si falta) y
//     carga sugerencias automáticamente, mostrando "Analizando tus
//     fotos..." durante los ~10-20 seg que tarda.
//
// Props:
//   listingId         uuid (requerido para habilitar).
//   currentTitle      título actual en el form (contexto para la IA).
//   currentDescription descripción actual.
//   onApplyTitle      (newTitle) => void. Normalmente formApi.change.
//   onApplyDescription (newDesc) => void.
//   className         opcional.

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

const useAutoSuggestParam = () => {
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  return params.get('autoSuggest') === '1';
};

const AiSuggestionsBox = ({
  listingId,
  currentTitle,
  currentDescription,
  onApplyTitle,
  onApplyDescription,
  className,
}) => {
  const autoSuggest = useAutoSuggestParam();
  const [state, setState] = useState({
    phase: 'idle', // 'idle' | 'analyzing' | 'suggesting' | 'ready' | 'error'
    error: null,
    suggestions: null,
  });
  const [expanded, setExpanded] = useState(false);
  const autoTriggeredRef = useRef(false);

  const canUse = !!listingId;

  const runSuggestFlow = async () => {
    // Fase 1: pedir sugerencias directamente.
    setState({ phase: 'suggesting', error: null, suggestions: null });
    let r = await api('/api/ai/suggest-listing-text', {
      listingId,
      currentTitle,
      currentDescription,
    });

    // Fase 2: si el listing no tiene aiAnalysis todavía, disparamos
    // análisis sync (~10-20s) y reintentamos.
    if (!r.ok && r.data?.error === 'needs_analysis_first') {
      setState({ phase: 'analyzing', error: null, suggestions: null });
      const analyzeRes = await api('/api/ai/analyze-listing', {
        listingId,
        async: false,
      });
      if (!analyzeRes.ok) {
        const code = analyzeRes.data?.error;
        setState({
          phase: 'error',
          error:
            code === 'listing_not_found'
              ? 'No encontramos tu listing. Guarda este paso primero.'
              : `No pudimos analizar tus fotos (${code || 'error'}). Intenta de nuevo.`,
          suggestions: null,
        });
        return;
      }
      // Reintenta suggest tras análisis exitoso.
      setState({ phase: 'suggesting', error: null, suggestions: null });
      r = await api('/api/ai/suggest-listing-text', {
        listingId,
        currentTitle,
        currentDescription,
      });
    }

    if (!r.ok) {
      const code = r.data?.error;
      let userError;
      if (code === 'needs_analysis_first') {
        userError =
          'Primero sube al menos una foto en el paso Fotos y vuelve aquí para activar las sugerencias.';
      } else if (code === 'unauthenticated') {
        userError = 'Tu sesión expiró. Recarga la página e intenta de nuevo.';
      } else if (code === 'not_your_listing') {
        userError = 'No puedes pedir sugerencias para un listing ajeno.';
      } else if (code === 'ai_not_configured') {
        userError = 'La IA está temporalmente deshabilitada. Intenta más tarde.';
      } else {
        userError = `Error: ${code || 'desconocido'}. Intenta de nuevo en un momento.`;
      }
      setState({ phase: 'error', error: userError, suggestions: null });
      return;
    }

    setState({ phase: 'ready', error: null, suggestions: r.data });
    setExpanded(true);
  };

  // Auto-trigger cuando viene con ?autoSuggest=1 desde el paso Fotos.
  useEffect(() => {
    if (
      autoSuggest &&
      canUse &&
      !autoTriggeredRef.current &&
      state.phase === 'idle'
    ) {
      autoTriggeredRef.current = true;
      runSuggestFlow();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSuggest, canUse]);

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

  const { phase, error, suggestions } = state;
  const isBusy = phase === 'analyzing' || phase === 'suggesting';

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

      {(!expanded || !suggestions) && !isBusy ? (
        <div className={css.intro}>
          <p className={css.hint}>
            Nuestra IA analiza tus fotos y te sugiere títulos, descripciones y
            metadata de SEO más efectivos. Si todavía no has subido fotos,
            guarda este paso y hazlo en el paso <strong>Fotos</strong>; después
            vuelve aquí.
          </p>
          <button
            type="button"
            className={css.primaryBtn}
            onClick={runSuggestFlow}
            disabled={isBusy}
          >
            ✨ Mejorar con IA
          </button>
        </div>
      ) : null}

      {phase === 'analyzing' ? (
        <div className={css.analyzingBox}>
          <div className={css.spinner} aria-hidden="true" />
          <div>
            <p className={css.analyzingTitle}>Analizando tus fotos con IA…</p>
            <p className={css.analyzingSub}>
              Esto puede tardar hasta 20 segundos. No cierres esta pestaña.
            </p>
          </div>
        </div>
      ) : null}

      {phase === 'suggesting' ? (
        <div className={css.analyzingBox}>
          <div className={css.spinner} aria-hidden="true" />
          <p className={css.analyzingTitle}>Generando sugerencias…</p>
        </div>
      ) : null}

      {error ? <p className={css.error}>{error}</p> : null}

      {expanded && suggestions ? (
        <div className={css.suggestions}>
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
              onClick={runSuggestFlow}
              disabled={isBusy}
            >
              ↻ Regenerar sugerencias
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default AiSuggestionsBox;
