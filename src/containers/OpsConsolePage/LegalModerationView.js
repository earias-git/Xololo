import React, { useCallback, useEffect, useState } from 'react';

import { apiBaseUrl } from '../../util/api';

import css from './OpsConsolePage.module.css';

// XOLOLO: cola de moderación de legalidad para Ops.
//
// Dos tipos de items:
//  - verdict='illegal' → listing bloqueado automático por IA (state=closed).
//    Ops decide: Reabrir (falso positivo) o Confirmar bloqueo.
//  - verdict='needs_review' → dual-use (químicos, meds sin receta,
//    vigilancia, cripto p2p). Listing sigue publicado. Ops decide:
//    Bloquear o Marcar legal.
//
// Items con opsDecision ya establecida aparecen al final (resueltos).

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

const formatMoney = price => {
  if (!price) return '—';
  const amount = (price.amount || 0) / 100;
  try {
    return new Intl.NumberFormat('es-MX', {
      style: 'currency',
      currency: price.currency || 'MXN',
    }).format(amount);
  } catch (_) {
    return `${amount.toFixed(2)} ${price.currency || ''}`;
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

const VERDICT_META = {
  illegal: { label: '🛑 Ilegal (bloqueado por IA)', cls: 'aiVerdictRed' },
  needs_review: { label: '⚠️ Dual-use (sigue publicado)', cls: 'aiVerdictYellow' },
  legal: { label: '✓ Legal', cls: 'aiVerdictGreen' },
};

const DECISION_META = {
  reopen: { label: '↩ Reabierto por Ops', cls: 'aiVerdictGreen' },
  confirm_block: { label: '🛑 Bloqueo confirmado', cls: 'aiVerdictRed' },
  mark_legal: { label: '✓ Marcado legal', cls: 'aiVerdictGreen' },
};

const LegalModerationView = ({ onBack }) => {
  const [state, setState] = useState({ loading: true, items: [], stats: {}, error: null });
  const [deciding, setDeciding] = useState({});
  const [note, setNote] = useState({});

  const load = useCallback(async () => {
    setState(s => ({ ...s, loading: true, error: null }));
    const { ok, data } = await api('/api/admin/legal-moderation');
    if (!ok) {
      setState({ loading: false, items: [], stats: {}, error: data?.error || 'load_failed' });
      return;
    }
    setState({ loading: false, items: data.items || [], stats: data.stats || {}, error: null });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const decide = async (listingId, decision) => {
    setDeciding(prev => ({ ...prev, [listingId]: decision }));
    const { ok, data } = await api('/api/admin/legal-moderation/decide', {
      method: 'POST',
      body: { listingId, decision, note: note[listingId] || null },
    });
    setDeciding(prev => {
      const next = { ...prev };
      delete next[listingId];
      return next;
    });
    if (!ok) {
      alert(`Error: ${data?.error || 'desconocido'}`);
      return;
    }
    load();
  };

  const { items, stats, loading, error } = state;
  const pendingCount = items.filter(i => !i.moderation.opsDecision).length;

  return (
    <div className={css.viewRoot}>
      <div className={css.viewHeader}>
        <button type="button" className={css.backBtn} onClick={onBack}>
          ← Dashboard
        </button>
        <h2 className={css.viewTitle}>Moderación de legalidad</h2>
      </div>

      {loading ? (
        <p className={css.loading}>Cargando…</p>
      ) : error ? (
        <p className={css.error}>Error: {error}</p>
      ) : (
        <>
          <div className={css.statCardRow}>
            <div className={css.statCard}>
              <span className={css.statLabel}>Ilegales bloqueados</span>
              <span className={css.statValue}>{stats.illegal || 0}</span>
            </div>
            <div className={css.statCard}>
              <span className={css.statLabel}>Dual-use (needs review)</span>
              <span className={css.statValue}>{stats.needsReview || 0}</span>
            </div>
            <div className={css.statCard}>
              <span className={css.statLabel}>Resueltos por Ops</span>
              <span className={css.statValue}>{stats.resolved || 0}</span>
            </div>
            <div className={css.statCard}>
              <span className={css.statLabel}>Pendientes de decisión</span>
              <span className={css.statValue}>{pendingCount}</span>
            </div>
          </div>

          {items.length === 0 ? (
            <p className={css.empty}>
              Sin listings flagueados. La IA no detectó contenido ilícito ni dual-use en las
              publicaciones recientes.
            </p>
          ) : (
            <div className={css.taxReviewList}>
              {items.map(item => {
                const m = item.moderation || {};
                const verdictMeta = VERDICT_META[m.verdict] || { label: m.verdict, cls: '' };
                const decisionMeta = m.opsDecision ? DECISION_META[m.opsDecision] : null;
                const busy = !!deciding[item.listingId];
                return (
                  <article key={item.listingId} className={css.taxReviewCard}>
                    <header className={css.taxReviewHeader}>
                      <div>
                        <h3 className={css.taxReviewTitle}>{item.title}</h3>
                        <p className={css.taxReviewMeta}>
                          {formatMoney(item.price)}
                          {item.categoryId ? ` · ${item.categoryId}` : ''}
                          {item.listingType ? ` · ${item.listingType}` : ''}
                          {` · state=${item.state}`}
                        </p>
                        <p className={css.taxReviewMeta}>
                          Seller: <strong>{item.authorName || '(sin nombre)'}</strong>
                          {item.authorEmail ? ` · ${item.authorEmail}` : ''}
                        </p>
                      </div>
                      <div className={css.cardStatuses}>
                        <span className={`${css.aiVerdictPill} ${css[verdictMeta.cls] || ''}`}>
                          {verdictMeta.label}
                          <span className={css.aiConfidence}>· {m.confidence}%</span>
                        </span>
                        {decisionMeta ? (
                          <span className={`${css.aiVerdictPill} ${css[decisionMeta.cls] || ''}`}>
                            {decisionMeta.label}
                          </span>
                        ) : null}
                      </div>
                    </header>

                    <section className={css.aiReviewBlock}>
                      {m.category ? (
                        <p className={css.aiReasoning}>
                          <strong>Categoría:</strong> {m.category}
                        </p>
                      ) : null}
                      {m.reasoning ? <p className={css.aiReasoning}>{m.reasoning}</p> : null}
                      {Array.isArray(m.evidence) && m.evidence.length > 0 ? (
                        <ul className={css.aiRedFlags}>
                          {m.evidence.map((e, i) => (
                            <li key={i}>«{e}»</li>
                          ))}
                        </ul>
                      ) : null}
                      {item.description ? (
                        <details>
                          <summary className={css.linkBtn}>Ver descripción completa</summary>
                          <p className={css.taxReviewDesc}>{item.description}</p>
                        </details>
                      ) : null}
                      <p className={css.taxReviewMeta}>
                        Moderado: {formatDate(m.moderatedAt)}
                        {m.reviewedBy
                          ? ` · decidido por ${m.reviewedBy} el ${formatDate(m.reviewedAt)}`
                          : ''}
                      </p>
                    </section>

                    {!m.opsDecision ? (
                      <section className={css.taxReviewActions}>
                        <input
                          type="text"
                          className={css.input}
                          placeholder="Nota opcional (razón de la decisión)"
                          value={note[item.listingId] || ''}
                          onChange={e =>
                            setNote(prev => ({ ...prev, [item.listingId]: e.target.value }))
                          }
                          disabled={busy}
                        />
                        <div className={css.taxReviewBtns}>
                          {m.verdict === 'illegal' ? (
                            <>
                              <button
                                type="button"
                                className={css.approveBtn}
                                disabled={busy}
                                onClick={() => decide(item.listingId, 'reopen')}
                              >
                                {deciding[item.listingId] === 'reopen'
                                  ? 'Reabriendo…'
                                  : '↩ Reabrir (falso positivo)'}
                              </button>
                              <button
                                type="button"
                                className={css.rejectBtn}
                                disabled={busy}
                                onClick={() => decide(item.listingId, 'confirm_block')}
                              >
                                {deciding[item.listingId] === 'confirm_block'
                                  ? 'Confirmando…'
                                  : '🛑 Confirmar bloqueo'}
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                type="button"
                                className={css.approveBtn}
                                disabled={busy}
                                onClick={() => decide(item.listingId, 'mark_legal')}
                              >
                                {deciding[item.listingId] === 'mark_legal'
                                  ? 'Guardando…'
                                  : '✓ Marcar legal'}
                              </button>
                              <button
                                type="button"
                                className={css.rejectBtn}
                                disabled={busy}
                                onClick={() => decide(item.listingId, 'confirm_block')}
                              >
                                {deciding[item.listingId] === 'confirm_block'
                                  ? 'Bloqueando…'
                                  : '🛑 Bloquear'}
                              </button>
                            </>
                          )}
                        </div>
                      </section>
                    ) : null}
                  </article>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default LegalModerationView;
