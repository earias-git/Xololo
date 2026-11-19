// XOLOLO 2026-11-18 — ADR-006 PR-9: tab admin de Comunidades.
//
// Lista las comunidades (seed + overlay) y permite al operador
// publicar/despublicar sin redeploy. Mutaciones son volátiles:
// se pierden al reiniciar el proceso o al deployar. La UI avisa.
//
// Edición de branding/descripción = edit al seed + deploy (no
// hay CRUD runtime en V1).

import React, { useEffect, useState, useCallback } from 'react';
import { apiBaseUrl } from '../../util/api';

const TYPE_LABEL = {
  sectorial: 'Sector',
  geografica: 'Región',
  modelo: 'Programa',
};

const ROUTE_PREFIX = {
  sectorial: '/comunidad',
  geografica: '/region',
  modelo: '/programa',
};

const api = async (path, { method = 'GET' } = {}) => {
  const res = await fetch(`${apiBaseUrl()}${path}`, {
    method,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
};

const Badge = ({ color, children }) => (
  <span
    style={{
      background: color,
      color: '#fff',
      padding: '2px 8px',
      borderRadius: 999,
      fontSize: 11,
      fontWeight: 600,
      display: 'inline-block',
    }}
  >
    {children}
  </span>
);

const CommunityRow = ({ community, onPublish, onUnpublish, onRecount, mutating }) => {
  const isPublished = !!community.isPublished;
  const hasOverlay = !!community.overlay;
  const slug = community.slug || community.id;
  const landing = `${ROUTE_PREFIX[community.type] || '/comunidad'}/${slug}`;

  return (
    <tr>
      <td style={{ padding: 10, borderBottom: '1px solid #f3f4f6' }}>
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: 6,
            background: community.branding?.primaryColor || '#2d5016',
            color: '#fff',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: 700,
            fontSize: 12,
          }}
        >
          {community.name
            ?.split(/[^a-zA-Z0-9]+/)
            .filter(Boolean)
            .map(p => p[0])
            .join('')
            .slice(0, 2)
            .toUpperCase() || 'C'}
        </div>
      </td>
      <td style={{ padding: 10, borderBottom: '1px solid #f3f4f6' }}>
        <div style={{ fontWeight: 600 }}>{community.name}</div>
        <div style={{ fontSize: 11, color: '#6b7280' }}>
          id: {community.id} · slug: {community.slug}
        </div>
      </td>
      <td style={{ padding: 10, borderBottom: '1px solid #f3f4f6', fontSize: 12 }}>
        {TYPE_LABEL[community.type] || community.type}
      </td>
      <td style={{ padding: 10, borderBottom: '1px solid #f3f4f6' }}>
        {isPublished ? (
          <Badge color="#065f46">Publicada</Badge>
        ) : (
          <Badge color="#9ca3af">Borrador</Badge>
        )}
        {hasOverlay ? (
          <div
            title={`Overlay: ${community.overlay.updatedBy || 'unknown'} · ${new Date(
              community.overlay.updatedAt
            ).toLocaleString('es-MX')}`}
            style={{ fontSize: 10, color: '#92400e', marginTop: 4 }}
          >
            ⚠️ overlay runtime (volátil)
          </div>
        ) : null}
      </td>
      <td style={{ padding: 10, borderBottom: '1px solid #f3f4f6', fontSize: 13 }}>
        {community.sellerCount || 0}
        <button
          type="button"
          onClick={() => onRecount(community.id)}
          disabled={!!mutating}
          style={{
            background: 'none',
            border: '1px solid #d1d5db',
            borderRadius: 4,
            padding: '2px 8px',
            fontSize: 11,
            marginLeft: 6,
            cursor: 'pointer',
          }}
          title="Recalcular contando sellers reales via Integration SDK"
        >
          ↻
        </button>
      </td>
      <td style={{ padding: 10, borderBottom: '1px solid #f3f4f6' }}>
        <a
          href={landing}
          target="_blank"
          rel="noopener noreferrer"
          style={{ fontSize: 12, color: '#1e3a8a', textDecoration: 'none' }}
        >
          {landing} ↗
        </a>
      </td>
      <td style={{ padding: 10, borderBottom: '1px solid #f3f4f6' }}>
        {isPublished ? (
          <button
            type="button"
            onClick={() => onUnpublish(community.id)}
            disabled={!!mutating}
            style={{
              background: '#fff',
              border: '1px solid #d1d5db',
              borderRadius: 6,
              padding: '6px 10px',
              fontSize: 12,
              cursor: mutating ? 'wait' : 'pointer',
            }}
          >
            Despublicar
          </button>
        ) : (
          <button
            type="button"
            onClick={() => onPublish(community.id)}
            disabled={!!mutating}
            style={{
              background: '#065f46',
              color: '#fff',
              border: 'none',
              borderRadius: 6,
              padding: '6px 10px',
              fontSize: 12,
              fontWeight: 600,
              cursor: mutating ? 'wait' : 'pointer',
            }}
          >
            Publicar
          </button>
        )}
      </td>
    </tr>
  );
};

const CommunitiesView = ({ onBack }) => {
  const [communities, setCommunities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [mutating, setMutating] = useState(null);
  const [recountMsg, setRecountMsg] = useState(null);
  // XOLOLO PR-5: estado del repair del mirror.
  const [repairState, setRepairState] = useState(null); // {dryRun, stats} | null
  const [repairing, setRepairing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const r = await api('/api/admin/communities');
    if (r.ok) {
      setCommunities(r.data.communities || []);
    } else {
      setError(r.data?.error || `HTTP ${r.status}`);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handlePublish = async id => {
    setMutating(id);
    const r = await api(`/api/admin/communities/${id}/publish`, { method: 'POST' });
    setMutating(null);
    if (!r.ok) {
      setError(r.data?.error || `HTTP ${r.status}`);
    }
    await load();
  };

  const handleUnpublish = async id => {
    if (!window.confirm(`¿Despublicar "${id}"? La landing dejará de ser accesible.`)) {
      return;
    }
    setMutating(id);
    const r = await api(`/api/admin/communities/${id}/unpublish`, { method: 'POST' });
    setMutating(null);
    if (!r.ok) {
      setError(r.data?.error || `HTTP ${r.status}`);
    }
    await load();
  };

  // XOLOLO PR-5: dispara el repair del mirror. En dryRun=true cuenta
  // cuántos listings tienen drift sin modificar nada; con dryRun=false
  // actualiza. El cron de Render corre esto apply nightly; el botón
  // aquí sirve para un repair manual tras un incidente.
  const handleRepair = async dryRun => {
    if (!dryRun && !window.confirm(
      '¿Ejecutar reparación REAL del mirror? Puede actualizar muchos listings. Confirma solo si corres tras un dry-run previo.'
    )) {
      return;
    }
    setRepairing(true);
    setRepairState(null);
    try {
      const res = await fetch(`${apiBaseUrl()}/api/admin/communities/mirror-repair`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dryRun }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setRepairState({ dryRun, stats: data });
      } else {
        setError(data?.error || `HTTP ${res.status}`);
      }
    } catch (e) {
      setError(e.message || 'repair_failed');
    } finally {
      setRepairing(false);
    }
  };

  const handleRecount = async id => {
    setMutating(id);
    setRecountMsg(null);
    const r = await api(`/api/admin/communities/${id}/recount-sellers`, { method: 'POST' });
    setMutating(null);
    if (r.ok) {
      setRecountMsg(`✓ ${id}: ${r.data.sellerCount} sellers (volátil — para persistir, commit al seed).`);
    } else {
      setError(r.data?.error || `HTTP ${r.status}`);
    }
  };

  return (
    <div style={{ padding: 24, maxWidth: 1200, margin: '0 auto' }}>
      <button
        type="button"
        onClick={onBack}
        style={{
          background: 'none',
          border: 'none',
          color: '#1e3a8a',
          cursor: 'pointer',
          fontSize: 13,
          padding: 0,
          marginBottom: 12,
        }}
      >
        ← Volver al dashboard
      </button>
      <h1 style={{ marginTop: 0, fontSize: 24 }}>🌳 Comunidades</h1>
      <p style={{ color: '#6b7280', fontSize: 14, marginBottom: 16 }}>
        Sectoriales (p.ej. OPF – Sector Verde), regionales (/region/:slug), programas
        (/programa/:slug). Publicar/despublicar es inmediato pero <strong>volátil</strong>:
        se pierde al redeploy. Para persistir entre deploys, commit{' '}
        <code>isPublished</code> a <code>src/config/communities.js</code>.
      </p>

      <div
        style={{
          background: '#fef3c7',
          border: '1px solid #fcd34d',
          borderRadius: 6,
          padding: 12,
          marginBottom: 16,
          fontSize: 13,
        }}
      >
        <strong>⚠️ Alcance V1:</strong> esta UI permite solo publicar/despublicar + recuento
        de sellers. Edición de branding, nombre, bylaws, etc. → edita{' '}
        <code>src/config/communities.js</code> en el repo + deploy. Crear comunidades nuevas
        también va al archivo.
      </div>

      {error ? (
        <div
          style={{
            background: '#fef2f2',
            border: '1px solid #fca5a5',
            color: '#991b1b',
            padding: 10,
            borderRadius: 6,
            marginBottom: 12,
            fontSize: 13,
          }}
        >
          Error: {error}
        </div>
      ) : null}

      {recountMsg ? (
        <div
          style={{
            background: '#ecfdf5',
            border: '1px solid #6ee7b7',
            color: '#065f46',
            padding: 10,
            borderRadius: 6,
            marginBottom: 12,
            fontSize: 13,
          }}
        >
          {recountMsg}
        </div>
      ) : null}

      {/* XOLOLO PR-5: panel de reparación del mirror. */}
      <div
        style={{
          background: '#eef2ff',
          border: '1px solid #c7d2fe',
          borderRadius: 6,
          padding: 12,
          marginBottom: 16,
          fontSize: 13,
        }}
      >
        <strong>🔧 Reparación del mirror listing↔profile:</strong>{' '}
        resincroniza <code>listing.publicData.sellerCommunities</code> para
        todos los sellers con memberships. Útil tras un join/leave con error
        parcial o cambios en el catálogo. Ejecuta primero dry-run.
        <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={() => handleRepair(true)}
            disabled={repairing}
            style={{
              background: '#fff',
              border: '1px solid #c7d2fe',
              borderRadius: 6,
              padding: '6px 12px',
              fontSize: 12,
              cursor: repairing ? 'wait' : 'pointer',
            }}
          >
            {repairing ? 'Ejecutando…' : 'Dry-run'}
          </button>
          <button
            type="button"
            onClick={() => handleRepair(false)}
            disabled={repairing}
            style={{
              background: '#1e3a8a',
              color: '#fff',
              border: 'none',
              borderRadius: 6,
              padding: '6px 12px',
              fontSize: 12,
              fontWeight: 600,
              cursor: repairing ? 'wait' : 'pointer',
            }}
          >
            Apply (REAL)
          </button>
        </div>
        {repairState ? (
          <div
            style={{
              marginTop: 8,
              padding: 10,
              background: '#fff',
              borderRadius: 6,
              border: '1px solid #c7d2fe',
              fontSize: 12,
            }}
          >
            <div style={{ fontWeight: 600, color: '#1e3a8a', marginBottom: 4 }}>
              {repairState.dryRun ? '📋 Dry-run' : '✓ Apply'}{' '}
              · {Math.round((repairState.stats.durationMs || 0) / 100) / 10}s
            </div>
            <div>
              Users escaneados: {repairState.stats.usersScanned} ·
              Con memberships: {repairState.stats.usersWithMemberships}
            </div>
            <div>
              Listings escaneados: {repairState.stats.listingsScanned} ·
              {repairState.dryRun ? 'Drift detectado' : 'Actualizados'}: <strong>{repairState.stats.listingsUpdated}</strong> ·
              Saltados: {repairState.stats.listingsSkipped} ·
              Errores: {repairState.stats.errors}
            </div>
            {repairState.stats.drift?.length > 0 ? (
              <details style={{ marginTop: 6 }}>
                <summary style={{ cursor: 'pointer' }}>
                  Ver {repairState.stats.drift.length} drifts (sample)
                </summary>
                <pre style={{ fontSize: 11, marginTop: 4, overflowX: 'auto' }}>
                  {JSON.stringify(repairState.stats.drift, null, 2)}
                </pre>
              </details>
            ) : null}
          </div>
        ) : null}
      </div>

      {loading ? (
        <div style={{ padding: 24, textAlign: 'center', color: '#6b7280' }}>Cargando…</div>
      ) : communities.length === 0 ? (
        <div style={{ padding: 24, textAlign: 'center', color: '#6b7280' }}>
          Sin comunidades en el seed.
        </div>
      ) : (
        <div
          style={{
            background: '#fff',
            border: '1px solid #e5e7eb',
            borderRadius: 8,
            overflow: 'hidden',
          }}
        >
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: '#f9fafb' }}>
                  <th style={{ padding: 10, textAlign: 'left' }}></th>
                  <th style={{ padding: 10, textAlign: 'left' }}>Comunidad</th>
                  <th style={{ padding: 10, textAlign: 'left' }}>Tipo</th>
                  <th style={{ padding: 10, textAlign: 'left' }}>Estado</th>
                  <th style={{ padding: 10, textAlign: 'left' }}>Sellers</th>
                  <th style={{ padding: 10, textAlign: 'left' }}>Landing</th>
                  <th style={{ padding: 10, textAlign: 'left' }}>Acción</th>
                </tr>
              </thead>
              <tbody>
                {communities.map(c => (
                  <CommunityRow
                    key={c.id}
                    community={c}
                    onPublish={handlePublish}
                    onUnpublish={handleUnpublish}
                    onRecount={handleRecount}
                    mutating={mutating}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

export default CommunitiesView;
