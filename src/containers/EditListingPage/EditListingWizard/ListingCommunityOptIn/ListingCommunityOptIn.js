/**
 * XOLOLO 2026-11-19 — Opt-in/Opt-out de comunidades por listing + taxonomía.
 *
 * Panel compacto al final del tab Detalles. Lista las comunidades del
 * seller con el modo correcto:
 *   - Sectoriales (OPF): checkbox OFF por default (opt-in). Al tildar,
 *     se muestran los filterGroups de esa comunidad para que el seller
 *     elija a qué sección pertenece (y preseteamos categoryLevel1/2).
 *   - Geográficas (Morelos): checkbox ON por default (opt-out).
 *
 * Fuentes de verdad en el listing:
 *   publicData.includeInCommunities[]   (opt-in explícito)
 *   publicData.excludeFromCommunities[] (opt-out explícito)
 *   publicData.categoryLevel1/2         (seteados al elegir filterGroup)
 *
 * Desacoplado del submit del wizard — PATCH directo al endpoint.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';

import { apiBaseUrl } from '../../../../util/api';

import css from './ListingCommunityOptIn.module.css';

const TYPE_LABEL = {
  sectorial: 'Sector',
  geografica: 'Región',
  modelo: 'Programa',
};

// Default de inclusión por tipo (mismo que el helper del server).
const defaultInclusionFor = community =>
  community?.listingDefaultInclusion ||
  (community?.type === 'geografica' ? 'opt-out' : 'opt-in');

const ListingCommunityOptIn = ({ listing }) => {
  const [myCommunities, setMyCommunities] = useState(null); // null = loading
  const [included, setIncluded] = useState(
    () => listing?.attributes?.publicData?.includeInCommunities || []
  );
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

  // XOLOLO 2026-11-19 — bug fix: hidratar SOLO cuando cambia el
  // listingId. Antes dependía de [listing] y el padre pasa una nueva
  // referencia en cada render → re-hidrataba a los valores originales,
  // haciendo parpadear el checkbox y descartando el estado optimista.
  useEffect(() => {
    setIncluded(listing?.attributes?.publicData?.includeInCommunities || []);
    setExcluded(listing?.attributes?.publicData?.excludeFromCommunities || []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listingId]);

  const persist = useCallback(
    async ({ nextIncluded, nextExcluded, previousIncluded, previousExcluded }) => {
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
            body: JSON.stringify({
              includeInCommunities: nextIncluded,
              excludeFromCommunities: nextExcluded,
            }),
          }
        );
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setIncluded(previousIncluded);
          setExcluded(previousExcluded);
          setError(data?.error || `HTTP ${res.status}`);
          setSavedAt(null);
        } else {
          setIncluded(data.included || []);
          setExcluded(data.excluded || []);
          setSavedAt(Date.now());
        }
      } catch (e) {
        setIncluded(previousIncluded);
        setExcluded(previousExcluded);
        setError(e.message || 'save_failed');
        setSavedAt(null);
      } finally {
        setSaving(false);
      }
    },
    [listingId]
  );

  // Toggle de check (cualquier tipo). Usa el modo del community para
  // decidir si mete/quita del include o del exclude.
  const toggle = community => {
    const mode = defaultInclusionFor(community);
    const previousIncluded = included;
    const previousExcluded = excluded;
    let nextIncluded = previousIncluded;
    let nextExcluded = previousExcluded;

    if (mode === 'opt-in') {
      // Modo opt-in: el checkbox tildado significa "incluir".
      if (previousIncluded.includes(community.id)) {
        nextIncluded = previousIncluded.filter(id => id !== community.id);
      } else {
        nextIncluded = [...previousIncluded, community.id];
      }
    } else {
      // Modo opt-out: el checkbox tildado significa "no excluir".
      if (previousExcluded.includes(community.id)) {
        nextExcluded = previousExcluded.filter(id => id !== community.id);
      } else {
        nextExcluded = [...previousExcluded, community.id];
      }
    }

    setIncluded(nextIncluded);
    setExcluded(nextExcluded);
    persist({ nextIncluded, nextExcluded, previousIncluded, previousExcluded });
  };

  // Chequea si el listing está "activo" en esta comunidad (visible).
  const isActiveFor = community => {
    const mode = defaultInclusionFor(community);
    if (mode === 'opt-in') return included.includes(community.id);
    return !excluded.includes(community.id);
  };

  const active = useMemo(
    () => (myCommunities || []).filter(c => !c._stale),
    [myCommunities]
  );

  if (myCommunities == null) return null;
  if (active.length === 0) return null;

  return (
    <section className={css.panel}>
      <header className={css.header}>
        <h3 className={css.title}>¿Este anuncio aplica a tus comunidades?</h3>
        <p className={css.subtitle}>
          Para comunidades por sector (como OPF – Sector Verde) debes activar
          manualmente cada anuncio que aplique: ej. una nochebuena sí, un
          escritorio usado no. Para comunidades por región (como Morelos) el
          anuncio aparece por default. Los cambios se guardan automático.
        </p>
      </header>

      <div className={css.list}>
        {active.map(c => {
          const isActive = isActiveFor(c);
          const mode = defaultInclusionFor(c);
          return (
            <CommunityRow
              key={`${c.type}:${c.id}`}
              community={c}
              isActive={isActive}
              mode={mode}
              onToggle={() => toggle(c)}
              saving={saving}
              listingId={listingId}
            />
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

// Fila por comunidad. Si está activa + tiene filterGroups, muestra
// un selector de sub-categoría que escribe categoryLevel1/2 del listing
// directamente via endpoint de team wrapper (si aplica) o via el
// listings.update del server del PATCH. Para V1 ofrecemos un enlace
// al tab Categoría del wizard para que el seller elija ahí.
const CommunityRow = ({ community, isActive, mode, onToggle, saving, listingId }) => {
  const [showTaxonomy, setShowTaxonomy] = useState(false);

  return (
    <div className={`${css.rowWrap} ${isActive ? css.rowWrapActive : ''}`}>
      <label className={css.row}>
        <input
          type="checkbox"
          checked={isActive}
          onChange={onToggle}
          disabled={saving}
          className={css.checkbox}
        />
        <span
          className={css.logo}
          style={{ background: community.branding?.primaryColor || '#2d5016' }}
        >
          {community.name
            ?.split(/[^a-zA-Z0-9]+/)
            .filter(Boolean)
            .map(p => p[0])
            .join('')
            .slice(0, 2)
            .toUpperCase() || 'C'}
        </span>
        <span className={css.info}>
          <span className={css.name}>{community.name}</span>
          <span className={css.meta}>
            {TYPE_LABEL[community.type] || community.type}
            {' · '}
            <span className={css.modeChip}>
              {mode === 'opt-in' ? 'activa manual' : 'incluido por región'}
            </span>
          </span>
        </span>
      </label>

      {/* Taxonomía sugerida — solo cuando está activa y la comunidad
          tiene filterGroups. Ayuda al seller a saber bajo qué chip
          aparecerá en la landing. */}
      {isActive && community.filterGroups?.length ? (
        <div className={css.taxonomy}>
          <button
            type="button"
            className={css.taxonomyToggle}
            onClick={() => setShowTaxonomy(v => !v)}
          >
            {showTaxonomy
              ? 'Ocultar categorías'
              : `¿En qué sección de ${community.name}?`}
          </button>
          {showTaxonomy ? (
            <div className={css.taxonomyBody}>
              <p className={css.taxonomyNote}>
                Asegúrate de que tu anuncio tenga la categoría correcta para
                que aparezca bajo el chip apropiado en la landing de{' '}
                {community.name}. Si no coincide ninguna, tu anuncio sigue
                apareciendo bajo &quot;Todos&quot;.
              </p>
              <ul className={css.taxonomyList}>
                {community.filterGroups.map(fg => (
                  <li key={fg.id} className={css.taxonomyItem}>
                    <span className={css.taxonomyEmoji}>{fg.emoji || '•'}</span>{' '}
                    <strong>{fg.label}</strong>{' '}
                    <code className={css.taxonomyMatch}>
                      {fg.match?.categoryLevel1}
                      {fg.match?.categoryLevel2 ? ` / ${fg.match.categoryLevel2}` : ''}
                    </code>
                  </li>
                ))}
              </ul>
              <a
                href={`/l/-/${listingId}/draft/details`}
                className={css.taxonomyLink}
              >
                Ir al tab Detalles para cambiar la categoría →
              </a>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};

export default ListingCommunityOptIn;
