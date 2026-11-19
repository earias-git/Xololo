/**
 * XOLOLO 2026-11-18 — Opt-out de comunidades por listing.
 *
 * Panel compacto que muestra las comunidades a las que pertenece el
 * seller y permite incluir/excluir ESTE listing específico.
 *
 * Diseño: componente standalone — hace su propio fetch+patch directo
 * al endpoint PATCH /api/me/listings/:id/communities. NO forma parte
 * del submit del wizard de EditListingDetailsPanel (desacoplado).
 *
 * Solo visible si el seller pertenece a ≥1 comunidad. Default: todas
 * las comunidades tildadas (el listing aparece en todas por defecto,
 * coincidente con el mirror). Al destildar, se agrega al array
 * excludeFromCommunities y el mirror del listing se recalcula server-side.
 */

import React, { useCallback, useEffect, useState } from 'react';

import { apiBaseUrl } from '../../../../util/api';

import css from './ListingCommunityOptIn.module.css';

const TYPE_LABEL = {
  sectorial: 'Sector',
  geografica: 'Región',
  modelo: 'Programa',
};

const ListingCommunityOptIn = ({ listing }) => {
  const [myCommunities, setMyCommunities] = useState(null); // null = loading
  const [excluded, setExcluded] = useState(
    () => listing?.attributes?.publicData?.excludeFromCommunities || []
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [savedAt, setSavedAt] = useState(null);

  const listingId = listing?.id?.uuid;

  // Carga las comunidades del seller.
  useEffect(() => {
    let cancelled = false;
    fetch(`${apiBaseUrl()}/api/me/communities`, { credentials: 'include' })
      .then(r => r.json())
      .then(data => {
        if (!cancelled) setMyCommunities(data?.communities || []);
      })
      .catch(() => {
        if (!cancelled) setMyCommunities([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Si cambia el listing (p.ej. post-save), refresca el exclude local.
  useEffect(() => {
    setExcluded(listing?.attributes?.publicData?.excludeFromCommunities || []);
  }, [listing]);

  const persist = useCallback(
    async nextExcluded => {
      if (!listingId) return;
      setSaving(true);
      setError(null);
      try {
        const res = await fetch(
          `${apiBaseUrl()}/api/me/listings/${listingId}/communities`,
          {
            method: 'PATCH',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ excludeFromCommunities: nextExcluded }),
          }
        );
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(data?.error || `HTTP ${res.status}`);
          // revert visualmente — la UI muestra lo que pediste pero
          // marcamos el error.
        } else {
          // El server devuelve excluded sanitizado — refleja lo que
          // realmente quedó persistido.
          setExcluded(data.excluded || []);
          setSavedAt(Date.now());
        }
      } catch (e) {
        setError(e.message || 'save_failed');
      } finally {
        setSaving(false);
      }
    },
    [listingId]
  );

  const toggle = communityId => {
    const nextExcluded = excluded.includes(communityId)
      ? excluded.filter(id => id !== communityId)
      : [...excluded, communityId];
    setExcluded(nextExcluded);
    persist(nextExcluded);
  };

  if (myCommunities == null) {
    // loading — no renderiza nada aún para evitar flash.
    return null;
  }
  // Filtra las comunidades stale (que ya no existen en el catálogo)
  // porque no se puede incluir/excluir de algo que no existe.
  const active = myCommunities.filter(c => !c._stale);
  if (active.length === 0) return null;

  return (
    <section className={css.panel}>
      <header className={css.header}>
        <h3 className={css.title}>¿Este anuncio aplica a tus comunidades?</h3>
        <p className={css.subtitle}>
          Elige en cuáles comunidades debe aparecer. Ej: una nochebuena sí aplica
          a OPF – Sector Verde, un escritorio usado no. Por default aparece en
          todas tus comunidades. Los cambios se guardan automático.
        </p>
      </header>

      <div className={css.list}>
        {active.map(c => {
          const checked = !excluded.includes(c.id);
          return (
            <label key={`${c.type}:${c.id}`} className={css.row}>
              <input
                type="checkbox"
                checked={checked}
                onChange={() => toggle(c.id)}
                disabled={saving}
                className={css.checkbox}
              />
              <span
                className={css.logo}
                style={{ background: c.branding?.primaryColor || '#2d5016' }}
              >
                {c.name
                  ?.split(/[^a-zA-Z0-9]+/)
                  .filter(Boolean)
                  .map(p => p[0])
                  .join('')
                  .slice(0, 2)
                  .toUpperCase() || 'C'}
              </span>
              <span className={css.info}>
                <span className={css.name}>{c.name}</span>
                <span className={css.meta}>{TYPE_LABEL[c.type] || c.type}</span>
              </span>
            </label>
          );
        })}
      </div>

      {saving ? <div className={css.hint}>Guardando…</div> : null}
      {savedAt && !saving ? (
        <div className={css.hintOk}>✓ Guardado</div>
      ) : null}
      {error ? <div className={css.hintError}>Error: {error}</div> : null}
    </section>
  );
};

export default ListingCommunityOptIn;
