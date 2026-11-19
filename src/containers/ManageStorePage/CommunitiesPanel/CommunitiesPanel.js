/**
 * XOLOLO 2026-11-18 — ADR-006 PR-7: panel "Comunidades" en /account/store.
 *
 * Sección que muestra las comunidades a las que pertenece el seller
 * y le permite unirse a otras. Usa el duck src/ducks/communities.duck.js
 * (fetchMyCommunities, joinCommunity, leaveCommunity).
 *
 * LOCKED (MODEL_COMMUNITIES_V1 §2.1):
 * - Unirse (membership='open') es ≤1 click + confirm pasivo (toast).
 * - Salir requiere confirm modal explícito.
 * - Comunidades `_stale` (en el profile pero no en el catálogo) se
 *   muestran con badge "no disponible" y permiten "Salir" para
 *   limpiar el profile.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';

import { apiBaseUrl } from '../../../util/api';
import {
  fetchMyCommunities,
  joinCommunity,
  leaveCommunity,
  selectMyCommunities,
  selectCommunitiesLoading,
  selectCommunitiesMutating,
  selectCommunitiesError,
  selectLastSyncStats,
} from '../../../ducks/communities.duck';

import css from './CommunitiesPanel.module.css';

const TYPE_LABEL = {
  sectorial: 'Sector',
  geografica: 'Región',
  modelo: 'Programa',
};

const initialsOf = name => {
  if (!name) return 'C';
  const parts = String(name).split(/[^a-zA-Z0-9]+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + (parts[1][0] || '')).toUpperCase();
};

const CommunityChip = ({ community, onLeave, mutating }) => {
  const bg = community.branding?.primaryColor || '#2d5016';
  const stale = !!community._stale;
  return (
    <div className={`${css.chip} ${stale ? css.chipStale : ''}`}>
      <div className={css.chipLogo} style={{ background: stale ? '#9ca3af' : bg }}>
        {initialsOf(community.name)}
      </div>
      <div className={css.chipBody}>
        <div className={css.chipName}>{community.name}</div>
        <div className={css.chipMeta}>
          {TYPE_LABEL[community.type] || community.type}
          {stale ? ' · no disponible' : ''}
        </div>
      </div>
      <button
        type="button"
        onClick={onLeave}
        disabled={mutating}
        className={css.chipLeave}
        aria-label={`Salir de ${community.name}`}
      >
        Salir
      </button>
    </div>
  );
};

const DiscoverCard = ({ community, onJoin, mutating, alreadyMember }) => {
  const bg = community.branding?.primaryColor || '#2d5016';
  const notOpen = community.membership && community.membership !== 'open';
  const needsCert = !!community.requiresCertification;
  const disabled = !!mutating || alreadyMember || notOpen || needsCert;
  return (
    <div className={css.discoverCard}>
      <div className={css.discoverLogo} style={{ background: bg }}>
        {initialsOf(community.name)}
      </div>
      <div className={css.discoverBody}>
        <div className={css.discoverTitle}>{community.name}</div>
        {community.tagline ? (
          <div className={css.discoverTagline}>{community.tagline}</div>
        ) : null}
        <div className={css.discoverMeta}>
          {TYPE_LABEL[community.type] || community.type} · 👥 {community.sellerCount || 0}
        </div>
        {notOpen ? (
          <div className={css.discoverNote}>
            Requiere solicitud (próximamente).
          </div>
        ) : null}
        {needsCert ? (
          <div className={css.discoverNote}>
            Requiere documentos de certificación (próximamente).
          </div>
        ) : null}
      </div>
      <button
        type="button"
        onClick={onJoin}
        disabled={disabled}
        className={css.discoverJoin}
      >
        {alreadyMember ? 'Ya eres miembro' : mutating ? 'Uniendo…' : 'Unirse'}
      </button>
    </div>
  );
};

const LeaveConfirmModal = ({ community, onConfirm, onCancel, mutating }) => (
  <div className={css.modalOverlay} onClick={onCancel}>
    <div className={css.modalBox} onClick={e => e.stopPropagation()}>
      <h3 className={css.modalTitle}>Salir de {community.name}</h3>
      <p className={css.modalBody}>
        Tus productos dejarán de aparecer en la landing de esta comunidad.
        Tu tienda no se ve afectada y puedes volver a unirte en cualquier
        momento.
      </p>
      <div className={css.modalActions}>
        <button type="button" onClick={onCancel} className={css.modalBtnCancel}>
          Cancelar
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={mutating}
          className={css.modalBtnConfirm}
        >
          {mutating ? 'Saliendo…' : 'Sí, salir'}
        </button>
      </div>
    </div>
  </div>
);

const CommunitiesPanel = () => {
  const dispatch = useDispatch();
  const myCommunities = useSelector(selectMyCommunities);
  const loading = useSelector(selectCommunitiesLoading);
  const mutating = useSelector(selectCommunitiesMutating);
  const error = useSelector(selectCommunitiesError);
  const lastSyncStats = useSelector(selectLastSyncStats);

  const [explore, setExplore] = useState(false);
  const [available, setAvailable] = useState(null); // null = not loaded
  const [availableLoading, setAvailableLoading] = useState(false);
  const [availableError, setAvailableError] = useState(null);
  const [leaveTarget, setLeaveTarget] = useState(null);
  const [recentAction, setRecentAction] = useState(null); // {type, name}

  // Carga inicial de las mías.
  useEffect(() => {
    if (!myCommunities && !loading) {
      dispatch(fetchMyCommunities());
    }
  }, [dispatch, myCommunities, loading]);

  // Cuando se abre "Explorar", pide la lista pública.
  useEffect(() => {
    if (!explore || available) return;
    let cancelled = false;
    setAvailableLoading(true);
    setAvailableError(null);
    fetch(`${apiBaseUrl()}/api/communities`, { credentials: 'include' })
      .then(r => r.json())
      .then(data => {
        if (!cancelled) setAvailable(data?.communities || []);
      })
      .catch(e => {
        if (!cancelled) setAvailableError(e.message || 'fetch_failed');
      })
      .finally(() => {
        if (!cancelled) setAvailableLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [explore, available]);

  // Set de ids a los que YA pertenece, para marcar en "Explorar".
  const myCommunityKeys = useMemo(() => {
    const set = new Set();
    (myCommunities || []).forEach(c => set.add(`${c.type}:${c.id}`));
    return set;
  }, [myCommunities]);

  const handleJoin = async community => {
    const action = await dispatch(
      joinCommunity({ slug: community.slug || community.id, type: community.type })
    );
    if (joinCommunity.fulfilled.match(action)) {
      setRecentAction({ type: 'join', name: community.name, stats: action.payload?.stats });
    }
  };

  const handleLeave = async () => {
    if (!leaveTarget) return;
    const action = await dispatch(
      leaveCommunity({
        slug: leaveTarget.slug || leaveTarget.id,
        type: leaveTarget.type,
      })
    );
    if (leaveCommunity.fulfilled.match(action)) {
      setRecentAction({ type: 'leave', name: leaveTarget.name, stats: action.payload?.stats });
    }
    setLeaveTarget(null);
  };

  const myCommunitiesArr = myCommunities || [];
  const hasMine = myCommunitiesArr.length > 0;

  return (
    <section className={css.panel}>
      <header className={css.header}>
        <h2 className={css.title}>Comunidades</h2>
        <p className={css.subtitle}>
          Las comunidades son redes sectoriales, geográficas o de modelo de negocio
          (p.ej. OPF – Sector Verde). Al unirte, tus productos aparecen en la landing
          de esa comunidad.
        </p>
      </header>

      {error ? (
        <div className={css.alertError}>
          No pudimos cargar tus comunidades: {error}
        </div>
      ) : null}

      {recentAction ? (
        <div className={css.alertOk}>
          {recentAction.type === 'join'
            ? `✓ Te uniste a ${recentAction.name}.`
            : `✓ Saliste de ${recentAction.name}.`}
          {recentAction.stats && recentAction.stats.total > 0
            ? ` Actualizamos ${recentAction.stats.updated}/${recentAction.stats.total} anuncios.`
            : ''}
          <button
            type="button"
            className={css.alertDismiss}
            onClick={() => setRecentAction(null)}
            aria-label="Cerrar"
          >
            ×
          </button>
        </div>
      ) : null}

      {loading && !hasMine ? (
        <div className={css.loading}>Cargando tus comunidades…</div>
      ) : hasMine ? (
        <div className={css.chips}>
          {myCommunitiesArr.map(c => (
            <CommunityChip
              key={`${c.type}:${c.id}`}
              community={c}
              onLeave={() => setLeaveTarget(c)}
              mutating={!!mutating}
            />
          ))}
        </div>
      ) : (
        <div className={css.emptyState}>
          Aún no perteneces a ninguna comunidad. Explora las disponibles abajo.
        </div>
      )}

      <div className={css.exploreToggleWrap}>
        <button
          type="button"
          onClick={() => setExplore(e => !e)}
          className={css.exploreToggle}
        >
          {explore ? 'Ocultar comunidades disponibles' : 'Explorar comunidades'}
        </button>
      </div>

      {explore ? (
        <div className={css.discover}>
          {availableLoading ? (
            <div className={css.loading}>Cargando…</div>
          ) : availableError ? (
            <div className={css.alertError}>Error: {availableError}</div>
          ) : available && available.length === 0 ? (
            <div className={css.emptyState}>
              No hay comunidades publicadas por ahora.
            </div>
          ) : (
            <div className={css.discoverList}>
              {(available || []).map(c => {
                const key = `${c.type}:${c.id}`;
                const alreadyMember = myCommunityKeys.has(key);
                return (
                  <DiscoverCard
                    key={key}
                    community={c}
                    alreadyMember={alreadyMember}
                    onJoin={() => handleJoin(c)}
                    mutating={!!mutating}
                  />
                );
              })}
            </div>
          )}
        </div>
      ) : null}

      {leaveTarget ? (
        <LeaveConfirmModal
          community={leaveTarget}
          onCancel={() => setLeaveTarget(null)}
          onConfirm={handleLeave}
          mutating={!!mutating}
        />
      ) : null}
    </section>
  );
};

export default CommunitiesPanel;
