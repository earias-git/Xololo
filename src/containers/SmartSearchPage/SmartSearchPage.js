import React, { useState, useEffect, useRef } from 'react';
import { useLocation, useHistory } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { Helmet } from 'react-helmet-async';

import { apiBaseUrl } from '../../util/api';
import { isScrollingDisabled } from '../../ducks/ui.duck';
import { Page, LayoutSingleColumn } from '../../components';
import TopbarContainer from '../../containers/TopbarContainer/TopbarContainer';
import FooterContainer from '../../containers/FooterContainer/FooterContainer';

import css from './SmartSearchPage.module.css';

// XOLOLO Fase 2 — F2-12. Búsqueda semántica con IA sobre todo el catálogo
// de Xololo. El buyer escribe en lenguaje natural (ej. "algo artesanal con
// flores para la cabeza") y Claude Haiku:
//   1. Interpreta la query (keywords, categorías, gift context).
//   2. Consulta Sharetribe con los filtros derivados.
//   3. Re-rankea resultados por match contra publicData.aiAnalysis.tags
//      (los tags visuales que Haiku extrajo al publicar cada listing).
//
// Esta es una página aparte del /s clásico. Permite comparar fácilmente
// y, cuando validemos la UX, migramos la lógica al SearchPage principal.

const useQueryParam = key => {
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  return params.get(key) || '';
};

const SmartSearchPage = () => {
  const scrollingDisabled = useSelector(isScrollingDisabled);
  const location = useLocation();
  const history = useHistory();
  const initialQuery = useQueryParam('q');

  const [input, setInput] = useState(initialQuery);
  const [state, setState] = useState({
    loading: false,
    error: null,
    results: null,
  });
  const abortRef = useRef(null);

  const runSearch = async q => {
    const trimmed = q.trim();
    if (!trimmed) {
      setState({ loading: false, error: null, results: null });
      return;
    }
    // Cancela request anterior si el user escribe rápido.
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setState({ loading: true, error: null, results: null });
    try {
      const url = `${apiBaseUrl()}/api/smart-search?q=${encodeURIComponent(trimmed)}&perPage=18`;
      const res = await fetch(url, { signal: controller.signal });
      const data = await res.json();
      if (!res.ok) {
        setState({ loading: false, error: data?.error || 'error', results: null });
        return;
      }
      setState({ loading: false, error: null, results: data });
    } catch (err) {
      if (err.name === 'AbortError') return;
      setState({ loading: false, error: err.message, results: null });
    }
  };

  // Al cargar la página con ?q=... en URL, dispara búsqueda.
  useEffect(() => {
    if (initialQuery) runSearch(initialQuery);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSubmit = e => {
    e.preventDefault();
    history.replace(`${location.pathname}?q=${encodeURIComponent(input)}`);
    runSearch(input);
  };

  const examples = [
    'regalo para mi mamá por su cumple',
    'algo artesanal con flores para la cabeza',
    'servicio para relajarme en Morelos',
    'maceta grande para jardín',
    'nochebuenas para decoración navideña',
  ];

  const { loading, error, results } = state;

  return (
    <Page
      title="Búsqueda con IA — Xololo"
      scrollingDisabled={scrollingDisabled}
      description="Describe en lenguaje natural lo que buscas y nuestra IA encuentra los mejores productos y servicios del marketplace."
    >
      <Helmet>
        <meta name="robots" content="noindex,follow" />
      </Helmet>
      <LayoutSingleColumn topbar={<TopbarContainer />} footer={<FooterContainer />}>
        <main className={css.container}>
          <header className={css.header}>
            <h1 className={css.title}>
              <span className={css.sparkle}>✨</span> Buscador con IA
            </h1>
            <p className={css.subtitle}>
              Describe en lenguaje natural lo que necesitas. Nuestra IA entiende
              intención, no sólo palabras.
            </p>
          </header>

          <form className={css.searchBar} onSubmit={handleSubmit}>
            <input
              type="text"
              className={css.searchInput}
              placeholder='Ej: "regalo artesanal para mi mamá"'
              value={input}
              onChange={e => setInput(e.target.value)}
              autoFocus
            />
            <button
              type="submit"
              className={css.searchBtn}
              disabled={loading || !input.trim()}
            >
              {loading ? 'Buscando…' : 'Buscar'}
            </button>
          </form>

          {!results && !loading ? (
            <div className={css.examples}>
              <p className={css.examplesHint}>Prueba estos ejemplos:</p>
              <ul className={css.exampleList}>
                {examples.map(ex => (
                  <li key={ex}>
                    <button
                      type="button"
                      className={css.exampleBtn}
                      onClick={() => {
                        setInput(ex);
                        history.replace(`${location.pathname}?q=${encodeURIComponent(ex)}`);
                        runSearch(ex);
                      }}
                    >
                      "{ex}"
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {loading ? (
            <div className={css.loadingBox}>
              <p>🤖 La IA está interpretando tu búsqueda…</p>
            </div>
          ) : null}

          {error ? (
            <div className={css.errorBox}>
              <p>Hubo un error al buscar. Intenta de nuevo.</p>
              <small>{error}</small>
            </div>
          ) : null}

          {results ? (
            <>
              <div className={css.intentBox}>
                <h3 className={css.intentTitle}>Entendí que buscas:</h3>
                <p className={css.intentText}>{results.intent}</p>
                {results.interpretation?.keywords?.length ? (
                  <p className={css.chips}>
                    {results.interpretation.keywords.slice(0, 10).map(k => (
                      <span key={k} className={css.chip}>
                        {k}
                      </span>
                    ))}
                  </p>
                ) : null}
                {results.fallbackUsed ? (
                  <p className={css.fallbackNote}>
                    (La IA no pudo interpretar la búsqueda; usamos búsqueda
                    clásica.)
                  </p>
                ) : null}
              </div>

              {results.listings.length === 0 ? (
                <div className={css.emptyBox}>
                  <p>No encontramos resultados para esta búsqueda.</p>
                  <p>Prueba con otras palabras o explora las categorías del catálogo.</p>
                </div>
              ) : (
                <div className={css.grid}>
                  {results.listings.map(l => (
                    <a key={l.id} href={l.href} className={css.card}>
                      {l.cover ? (
                        <div
                          className={css.cardCover}
                          style={{ backgroundImage: `url(${l.cover})` }}
                          role="img"
                          aria-label={l.title}
                        />
                      ) : (
                        <div className={css.cardCoverPlaceholder}>Sin imagen</div>
                      )}
                      <div className={css.cardBody}>
                        <h4 className={css.cardTitle}>{l.title}</h4>
                        <div className={css.cardMeta}>
                          {l.price ? (
                            <span className={css.cardPrice}>
                              ${l.price.toLocaleString('es-MX')} {l.currency || 'MXN'}
                            </span>
                          ) : null}
                          {l.category ? (
                            <span className={css.cardCategory}>{l.category}</span>
                          ) : null}
                        </div>
                        {l.score > 0 ? (
                          <span className={css.cardScore} title="Score de relevancia IA">
                            ✨ {l.score.toFixed(1)}
                          </span>
                        ) : null}
                      </div>
                    </a>
                  ))}
                </div>
              )}
            </>
          ) : null}
        </main>
      </LayoutSingleColumn>
    </Page>
  );
};

export default SmartSearchPage;
