import React, { useEffect, useState } from 'react';

import { apiBaseUrl } from '../../util/api';
import { IconSpinner } from '../../components';

import css from './MetaCommerceFeed.module.css';

// XOLOLO Promote v1 — Sub-commit 5: Feed Meta Commerce.
//
// Muestra al seller la URL pública del feed CSV que puede pegar en
// Meta Commerce Manager (Catalog > Add items > Data feed > Schedule).
// El endpoint CSV (/api/meta-feed/:sellerId.csv) sirve el feed con
// cache de 5 min; Meta lo re-fetches en el horario que el seller
// configure en Commerce Manager.
//
// La URL es "pública por entropía" (UUID v4) — Meta la fetchea con
// su crawler, sin auth, pero no es enumerable.
//
// UX: botón "Copiar URL" + link a Commerce Manager + guía de 3 pasos.

const fetchInfo = async () => {
  const res = await fetch(`${apiBaseUrl()}/api/meta-feed-info`, {
    credentials: 'include',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || 'fetch_failed');
    err.status = res.status;
    throw err;
  }
  return data;
};

const MetaCommerceFeed = () => {
  const [state, setState] = useState({ status: 'loading', data: null, error: null });
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchInfo().then(
      data => {
        if (!cancelled) setState({ status: 'ok', data, error: null });
      },
      err => {
        if (!cancelled)
          setState({ status: 'error', data: null, error: err?.message || 'fetch_failed' });
      }
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const handleCopy = async () => {
    if (!state.data?.feedUrl) return;
    try {
      await navigator.clipboard.writeText(state.data.feedUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch (e) {
      /* silent */
    }
  };

  const { data } = state;
  const commerceManagerUrl = 'https://business.facebook.com/commerce_manager/';

  return (
    <section className={css.root}>
      <div className={css.header}>
        <span className={css.icon} aria-hidden>
          📘
        </span>
        <div>
          <h3 className={css.title}>Feed para Meta Commerce (Facebook & Instagram)</h3>
          <p className={css.subtitle}>
            Publica automáticamente todos tus productos como catálogo en Facebook e Instagram
            Shopping.
          </p>
        </div>
      </div>

      {state.status === 'loading' ? (
        <div>
          <IconSpinner />
        </div>
      ) : null}

      {state.status === 'error' ? (
        <p className={css.error}>No pudimos cargar la URL del feed ({state.error}).</p>
      ) : null}

      {state.status === 'ok' && data?.listingCount === 0 ? (
        <p className={css.empty}>
          Aún no tienes productos publicados. Cuando publiques tu primer producto, aparecerá aquí la
          URL del feed.
        </p>
      ) : null}

      {state.status === 'ok' && data?.listingCount > 0 ? (
        <>
          <div className={css.urlRow}>
            <div className={css.urlBox} title={data.feedUrl}>
              {data.feedUrl}
            </div>
            <button type="button" className={`${css.btn} ${css.btnPrimary}`} onClick={handleCopy}>
              <span aria-hidden>🔗</span>
              <span>Copiar URL</span>
            </button>
            <a
              className={css.btn}
              href={commerceManagerUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              <span aria-hidden>↗</span>
              <span>Abrir Commerce Manager</span>
            </a>
          </div>
          {copied ? <p className={css.feedback}>✓ URL copiada al portapapeles</p> : null}
          <div className={css.hint}>
            <strong>Cómo conectarlo con Meta:</strong>
            <ol>
              <li>Abre Commerce Manager y entra a tu catálogo (o crea uno nuevo).</li>
              <li>
                <em>Add items → Data feed → Set up a scheduled feed</em> y pega esta URL.
              </li>
              <li>Programa la actualización (diaria recomendada). Meta leerá tus {data.listingCount} productos publicados.</li>
            </ol>
          </div>
        </>
      ) : null}
    </section>
  );
};

export default MetaCommerceFeed;
