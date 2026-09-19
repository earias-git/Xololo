import React, { useState } from 'react';
import classNames from 'classnames';

import { apiBaseUrl } from '../../util/api';

import css from './PostDeliverySurvey.module.css';

// XOLOLO: encuesta post-entrega para el buyer (docs/LOGISTICS_V1.md §4).
// Aparece en TransactionPage del CUSTOMER cuando la orden está en
// estado "entregado" y aún no se ha enviado la encuesta (ni la
// afirmativa ficta ha corrido).
//
// Flujo:
// 1. Buyer ve 2 botones grandes: "✅ Todo bien" o "⚠️ Algo mal"
// 2. "Todo bien" → despliega rating 1-5 estrellas + comentario opcional
//                  → POST /api/order-survey → completes transition
// 3. "Algo mal" → abre disputa automática (POST /api/order-report-issue)
//                  → transaction va a "disputed", fondos congelados
//
// Si no responde en 48h desde entrega, el cron D.8 (server-side) hace
// afirmativa ficta con acceptanceProof.type='tacit'.

const STAR_COUNT = 5;

const StarRow = ({ value, onChange, disabled }) => {
  const [hover, setHover] = useState(0);
  return (
    <div className={css.stars} role="radiogroup" aria-label="Calificación">
      {[1, 2, 3, 4, 5].map(n => (
        <button
          key={n}
          type="button"
          disabled={disabled}
          className={classNames(css.star, {
            [css.starFilled]: (hover || value) >= n,
          })}
          onClick={() => onChange(n)}
          onMouseEnter={() => setHover(n)}
          onMouseLeave={() => setHover(0)}
          aria-label={`${n} de ${STAR_COUNT} estrellas`}
        >
          {(hover || value) >= n ? '★' : '☆'}
        </button>
      ))}
    </div>
  );
};

const PostDeliverySurvey = ({ transactionId, onDone, className }) => {
  const [mode, setMode] = useState('idle'); // idle | good | bad | submitting | done
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState('');
  const [issueDetail, setIssueDetail] = useState('');
  const [error, setError] = useState(null);

  const submitGood = async () => {
    setError(null);
    setMode('submitting');
    try {
      const res = await fetch(`${apiBaseUrl()}/api/order-survey`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ transactionId, outcome: 'good', rating, comment }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.details || 'No pudimos guardar tu respuesta. Intenta de nuevo.');
        setMode('good');
        return;
      }
      setMode('done');
      if (typeof onDone === 'function') onDone({ outcome: 'good', rating, comment });
    } catch (e) {
      setError('Fallo de red al enviar la encuesta.');
      setMode('good');
    }
  };

  const submitBad = async () => {
    if (!issueDetail || issueDetail.trim().length < 10) {
      setError('Describe el problema con al menos 10 caracteres para abrir la disputa.');
      return;
    }
    setError(null);
    setMode('submitting');
    try {
      const res = await fetch(`${apiBaseUrl()}/api/order-survey`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ transactionId, outcome: 'bad', issueDetail }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.details || 'No pudimos abrir la disputa. Intenta de nuevo.');
        setMode('bad');
        return;
      }
      setMode('done');
      if (typeof onDone === 'function') onDone({ outcome: 'bad', issueDetail });
    } catch (e) {
      setError('Fallo de red al abrir la disputa.');
      setMode('bad');
    }
  };

  if (mode === 'done') {
    return (
      <section className={classNames(css.root, className)}>
        <div className={css.doneBanner}>
          <span className={css.doneIcon}>✓</span>
          <div>
            <p className={css.doneTitle}>Gracias, tu respuesta fue registrada</p>
            <p className={css.doneSubtitle}>
              Puedes cerrar esta ventana.
            </p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className={classNames(css.root, className)}>
      <header className={css.header}>
        <h3 className={css.title}>Confirma tu recepción</h3>
        <p className={css.subtitle}>
          Tu paquete fue marcado como entregado. Tienes 48 horas para reportar
          cualquier problema. Si no respondes, el pago se libera al vendedor
          automáticamente.
        </p>
      </header>

      {mode === 'idle' ? (
        <div className={css.ctaRow}>
          <button
            type="button"
            className={classNames(css.bigBtn, css.bigBtnGood)}
            onClick={() => setMode('good')}
          >
            <span className={css.bigBtnIcon}>✅</span>
            <span className={css.bigBtnLabel}>Todo bien</span>
            <span className={css.bigBtnSub}>Recibí mi pedido conforme</span>
          </button>
          <button
            type="button"
            className={classNames(css.bigBtn, css.bigBtnBad)}
            onClick={() => setMode('bad')}
          >
            <span className={css.bigBtnIcon}>⚠️</span>
            <span className={css.bigBtnLabel}>Algo mal</span>
            <span className={css.bigBtnSub}>Reportar problema con el pedido</span>
          </button>
        </div>
      ) : null}

      {mode === 'good' || mode === 'submitting' ? (
        <div className={css.detailForm}>
          <h4 className={css.detailTitle}>¿Cómo calificas al vendedor?</h4>
          <StarRow value={rating} onChange={setRating} disabled={mode === 'submitting'} />
          <label className={css.detailField}>
            <span className={css.detailLabel}>Comentario (opcional)</span>
            <textarea
              className={css.textarea}
              rows={3}
              value={comment}
              onChange={e => setComment(e.target.value.slice(0, 500))}
              disabled={mode === 'submitting'}
              placeholder="Ej. Excelente empaque, llegó antes de lo esperado…"
              maxLength={500}
            />
            <span className={css.charCount}>{comment.length}/500</span>
          </label>
          {error ? <p className={css.error}>{error}</p> : null}
          <div className={css.detailActions}>
            <button
              type="button"
              className={css.linkBtn}
              onClick={() => setMode('idle')}
              disabled={mode === 'submitting'}
            >
              Regresar
            </button>
            <button
              type="button"
              className={css.primaryBtn}
              onClick={submitGood}
              disabled={mode === 'submitting'}
            >
              {mode === 'submitting' ? 'Enviando…' : 'Confirmar recepción'}
            </button>
          </div>
        </div>
      ) : null}

      {mode === 'bad' || (mode === 'submitting' && issueDetail) ? (
        <div className={css.detailForm}>
          <h4 className={classNames(css.detailTitle, css.detailTitleBad)}>
            Reportar problema
          </h4>
          <p className={css.warningText}>
            Al reportar un problema los fondos se congelan mientras Xololo
            revisa. Recibirás una respuesta en menos de 72 horas.
          </p>
          <label className={css.detailField}>
            <span className={css.detailLabel}>Describe el problema *</span>
            <textarea
              className={css.textarea}
              rows={4}
              value={issueDetail}
              onChange={e => setIssueDetail(e.target.value.slice(0, 1000))}
              disabled={mode === 'submitting'}
              placeholder="Ej. El paquete llegó dañado, el producto tiene defectos, no recibí lo que compré…"
              maxLength={1000}
            />
            <span className={css.charCount}>{issueDetail.length}/1000 · mínimo 10</span>
          </label>
          {error ? <p className={css.error}>{error}</p> : null}
          <div className={css.detailActions}>
            <button
              type="button"
              className={css.linkBtn}
              onClick={() => setMode('idle')}
              disabled={mode === 'submitting'}
            >
              Regresar
            </button>
            <button
              type="button"
              className={classNames(css.primaryBtn, css.primaryBtnBad)}
              onClick={submitBad}
              disabled={mode === 'submitting'}
            >
              {mode === 'submitting' ? 'Enviando…' : 'Abrir disputa'}
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
};

export default PostDeliverySurvey;
