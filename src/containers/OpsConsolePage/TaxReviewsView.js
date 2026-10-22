import React, { useCallback, useEffect, useState } from 'react';

import { apiBaseUrl } from '../../util/api';
import {
  CLASSIFICATION_GROUPS,
  getClassificationByCode,
} from '../../util/xololoTaxClassification';

import css from './OpsConsolePage.module.css';

// XOLOLO Gate antifraude fiscal (task #39) — cola de revisión de las
// clasificaciones fiscales declaradas por sellers desde el form de Pricing.
//
// Cada item muestra: título + precio + categoría del listing, seller y email,
// la clasificación declarada con artículo legal y descripción del catálogo,
// y botones Aprobar / Rechazar que llaman al endpoint review.
//
// Al aprobar, el preview del seller y el motor de cobro aplican el override
// (ivaMode + taxActivity). Al rechazar, el listing sigue con el default
// conservador 16% + enajenación.

const api = async (path, opts = {}) => {
  const res = await fetch(`${apiBaseUrl()}${path}`, {
    method: opts.method || 'GET',
    credentials: 'include',
    headers: opts.body ? { 'Content-Type': 'application/json' } : {},
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
};

const GROUP_LABEL_BY_CODE = (() => {
  const m = new Map();
  CLASSIFICATION_GROUPS.forEach(g => g.items.forEach(c => m.set(c, g.label)));
  return m;
})();

const formatMoney = price => {
  if (!price) return '—';
  const amount = (price.amount || 0) / 100;
  try {
    return new Intl.NumberFormat('es-MX', {
      style: 'currency',
      currency: price.currency || 'MXN',
    }).format(amount);
  } catch (_) {
    return `${amount.toFixed(2)} ${price.currency || ''}`.trim();
  }
};

const formatDate = iso => {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('es-MX', {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch (_) {
    return iso;
  }
};

const STATUS_LABEL = {
  pending: '⏳ Pendiente',
  rejected: '❌ Rechazado',
  approved: '✅ Aprobado',
};

// XOLOLO #39: mapping del verdict de la IA a estilo visual (semáforo).
const AI_VERDICT_META = {
  likely_valid: { label: '✓ IA: probablemente válido', cls: 'aiVerdictGreen' },
  needs_review: { label: '⚠ IA: necesita revisión', cls: 'aiVerdictYellow' },
  likely_invalid: { label: '✗ IA: probablemente inválido', cls: 'aiVerdictRed' },
};

const TaxReviewsView = ({ onBack }) => {
  const [state, setState] = useState({ loading: true, items: [], error: null });
  const [reviewing, setReviewing] = useState({}); // {listingId: 'approve'|'reject'}
  const [note, setNote] = useState({}); // {listingId: '...'}
  const [aiLoading, setAiLoading] = useState({}); // {listingId: true}

  const load = useCallback(async () => {
    setState(s => ({ ...s, loading: true }));
    const r = await api('/api/admin/tax-reviews');
    if (r.ok) {
      setState({ loading: false, items: r.data.items || [], error: null });
    } else {
      setState({
        loading: false,
        items: [],
        error: r.data?.error || 'load_failed',
      });
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleAiClassify = async (listingId, force = false) => {
    setAiLoading(prev => ({ ...prev, [listingId]: true }));
    const r = await api('/api/admin/tax-reviews/ai-classify', {
      method: 'POST',
      body: { listingId, force },
    });
    setAiLoading(prev => {
      const next = { ...prev };
      delete next[listingId];
      return next;
    });
    if (!r.ok) {
      // eslint-disable-next-line no-alert
      alert(`Error al clasificar: ${r.data?.error || 'desconocido'}`);
      return;
    }
    // Actualiza sólo este item en el state local, sin reload de la lista.
    setState(prev => ({
      ...prev,
      items: prev.items.map(it =>
        it.listingId === listingId ? { ...it, aiReview: r.data.aiReview } : it
      ),
    }));
  };

  const handleReview = async (listingId, status) => {
    setReviewing(prev => ({ ...prev, [listingId]: status }));
    const r = await api('/api/admin/tax-reviews/review', {
      method: 'POST',
      body: { listingId, status, reviewNote: note[listingId] || null },
    });
    setReviewing(prev => {
      const next = { ...prev };
      delete next[listingId];
      return next;
    });
    if (!r.ok) {
      // eslint-disable-next-line no-alert
      alert(`Error al revisar: ${r.data?.error || 'desconocido'}`);
      return;
    }
    await load();
  };

  const items = state.items || [];
  const pendingCount = items.filter(
    i => i.taxClassification?.reviewStatus === 'pending'
  ).length;

  return (
    <div className={css.dashboard}>
      <header className={css.topBar}>
        <div>
          <button type="button" className={css.linkBtn} onClick={onBack}>
            ← Volver al dashboard
          </button>
          <h1 className={css.dashTitle}>Revisión fiscal de listings</h1>
          <p className={css.greeting}>
            Clasificaciones especiales (exento, tasa 0%, actividad distinta)
            declaradas por sellers. {pendingCount > 0 ? (
              <strong>{pendingCount} pendiente{pendingCount === 1 ? '' : 's'}</strong>
            ) : (
              'Sin pendientes.'
            )}
          </p>
        </div>
        <button type="button" className={css.primaryBtnInline} onClick={load}>
          Recargar
        </button>
      </header>

      {state.loading ? <p>Cargando…</p> : null}
      {state.error ? <p className={css.error}>Error: {state.error}</p> : null}

      {!state.loading && !state.error && items.length === 0 ? (
        <div className={css.card}>
          <p className={css.subtitle}>No hay clasificaciones por revisar en este momento.</p>
        </div>
      ) : null}

      {!state.loading && !state.error && items.length > 0 ? (
        <div className={css.taxReviewList}>
          {items.map(item => {
            const tc = item.taxClassification || {};
            const entry = getClassificationByCode(tc.code);
            const group = GROUP_LABEL_BY_CODE.get(tc.code);
            const busy = !!reviewing[item.listingId];

            return (
              <article key={item.listingId} className={css.taxReviewCard}>
                <header className={css.taxReviewHeader}>
                  <div>
                    <h3 className={css.taxReviewTitle}>{item.title}</h3>
                    <p className={css.taxReviewMeta}>
                      {formatMoney(item.price)}
                      {item.categoryId ? ` · ${item.categoryId}` : ''}
                      {item.createdAt ? ` · publicado ${formatDate(item.createdAt)}` : ''}
                    </p>
                    <p className={css.taxReviewMeta}>
                      Seller: <strong>{item.authorName || '(sin nombre)'}</strong>
                      {item.authorEmail ? ` · ${item.authorEmail}` : ''}
                    </p>
                  </div>
                  <span
                    className={`${css.statusPill} ${
                      tc.reviewStatus === 'pending' ? css.statusPending : css.statusRejected
                    }`}
                  >
                    {STATUS_LABEL[tc.reviewStatus] || tc.reviewStatus}
                  </span>
                </header>

                <section className={css.taxReviewBody}>
                  <div className={css.taxReviewLegal}>
                    <strong>{entry?.label || tc.code}</strong>
                    {entry?.ivaArticle ? (
                      <span className={css.taxReviewArticle}>{entry.ivaArticle}</span>
                    ) : null}
                    {group ? <span className={css.taxReviewGroup}>{group}</span> : null}
                    {entry?.description ? (
                      <p className={css.taxReviewDesc}>{entry.description}</p>
                    ) : null}
                  </div>

                  <dl className={css.taxReviewDl}>
                    <div>
                      <dt>Declarado</dt>
                      <dd>{formatDate(tc.declaredAt)}</dd>
                    </div>
                    {item.condition ? (
                      <div>
                        <dt>Condición</dt>
                        <dd>{item.condition}</dd>
                      </div>
                    ) : null}
                    {item.personType ? (
                      <div>
                        <dt>Tipo persona</dt>
                        <dd>{item.personType}</dd>
                      </div>
                    ) : null}
                    {tc.reviewedAt ? (
                      <div>
                        <dt>Revisión previa</dt>
                        <dd>
                          {formatDate(tc.reviewedAt)}
                          {tc.reviewedBy ? ` por ${tc.reviewedBy}` : ''}
                        </dd>
                      </div>
                    ) : null}
                    {tc.reviewNote ? (
                      <div>
                        <dt>Nota previa</dt>
                        <dd>{tc.reviewNote}</dd>
                      </div>
                    ) : null}
                  </dl>
                </section>

                {/* XOLOLO #39: pre-clasificación con IA. Contexto para el
                    operador: verdict + reasoning + red flags detectadas.
                    No sustituye su decisión — es ayuda, no autoridad. */}
                <section className={css.aiReviewBlock}>
                  {item.aiReview ? (
                    <>
                      <div
                        className={`${css.aiVerdictPill} ${
                          css[AI_VERDICT_META[item.aiReview.verdict]?.cls] || ''
                        }`}
                      >
                        {AI_VERDICT_META[item.aiReview.verdict]?.label || item.aiReview.verdict}
                        <span className={css.aiConfidence}>
                          · confianza {item.aiReview.confidence}%
                        </span>
                      </div>
                      {item.aiReview.reasoning ? (
                        <p className={css.aiReasoning}>{item.aiReview.reasoning}</p>
                      ) : null}
                      {Array.isArray(item.aiReview.redFlags) && item.aiReview.redFlags.length > 0 ? (
                        <ul className={css.aiRedFlags}>
                          {item.aiReview.redFlags.map((f, i) => (
                            <li key={i}>{f}</li>
                          ))}
                        </ul>
                      ) : null}
                      <button
                        type="button"
                        className={css.linkBtn}
                        disabled={!!aiLoading[item.listingId]}
                        onClick={() => handleAiClassify(item.listingId, true)}
                      >
                        {aiLoading[item.listingId] ? 'Analizando…' : 'Re-analizar con IA'}
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className={css.primaryBtnInline}
                      disabled={!!aiLoading[item.listingId]}
                      onClick={() => handleAiClassify(item.listingId, false)}
                    >
                      {aiLoading[item.listingId] ? 'Analizando…' : '🤖 Analizar con IA'}
                    </button>
                  )}
                </section>

                <section className={css.taxReviewActions}>
                  <input
                    type="text"
                    className={css.input}
                    placeholder="Nota opcional (razón del rechazo, pedido de evidencia…)"
                    value={note[item.listingId] || ''}
                    onChange={e =>
                      setNote(prev => ({ ...prev, [item.listingId]: e.target.value }))
                    }
                    disabled={busy}
                  />
                  <div className={css.taxReviewBtns}>
                    <button
                      type="button"
                      className={css.rejectBtn}
                      disabled={busy}
                      onClick={() => handleReview(item.listingId, 'rejected')}
                    >
                      {reviewing[item.listingId] === 'rejected' ? 'Rechazando…' : 'Rechazar'}
                    </button>
                    <button
                      type="button"
                      className={css.approveBtn}
                      disabled={busy}
                      onClick={() => handleReview(item.listingId, 'approved')}
                    >
                      {reviewing[item.listingId] === 'approved' ? 'Aprobando…' : 'Aprobar'}
                    </button>
                  </div>
                </section>
              </article>
            );
          })}
        </div>
      ) : null}
    </div>
  );
};

export default TaxReviewsView;
