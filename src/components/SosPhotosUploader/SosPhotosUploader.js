import React, { useRef, useState } from 'react';
import classNames from 'classnames';

import { apiBaseUrl } from '../../util/api';

import css from './SosPhotosUploader.module.css';

// XOLOLO: widget que gestiona las 5 fotos SOS obligatorias de una orden.
// El seller ve los 5 slots con instrucciones específicas por slot
// (referencia visual + hint textual) y sube cada foto individualmente.
// Cada upload va a POST /api/upload-sos-photo?transactionId=X&slot=Y y
// devuelve la URL en R2. El widget mantiene su propio state con las URLs
// subidas (o pre-cargadas via prop `initialUrls`) y llama onChange con
// el objeto completo cada vez que algo cambia.
//
// Ver docs/LOGISTICS_V1.md §5 — las 5 fotos son requisito de Skydropx
// SOS para reclamos por sobrepesos/daños. Los slots 4 (medidas) y 5
// (peso) son los CRÍTICOS.

const SLOTS = [
  {
    key: 'producto',
    title: '1. Producto sin embalar',
    hint:
      'El artículo tal cual es, sin caja ni bubble wrap. Fondo neutro; ' +
      'muéstralo completo.',
    goodTip: 'Todo el producto se ve, iluminación pareja.',
    badTip: 'Producto cortado, con reflejo, o con manos tapándolo.',
  },
  {
    key: 'embalado',
    title: '2. Producto embalado',
    hint:
      'Ya empacado con toda la protección final (cinta, bubble wrap, caja).',
    goodTip: 'Se ve el embalaje completo cerrado.',
    badTip: 'Embalaje abierto o incompleto.',
  },
  {
    key: 'guia',
    title: '3. Guía adherida al paquete',
    hint: 'La etiqueta Skydropx pegada al paquete, con el tracking legible.',
    goodTip: 'Se lee claramente el tracking number.',
    badTip: 'Guía borrosa, doblada o sin pegar todavía.',
  },
  {
    key: 'medidas',
    title: '4. Paquete con regla o flexómetro',
    hint:
      'Muestra ancho, alto y largo del paquete cerrado. La regla o ' +
      'flexómetro debe salir en la MISMA toma que el paquete. ' +
      '⚠️ Sin esta foto NO se paga reclamo por sobrepesos.',
    goodTip: 'Regla claramente sobre el paquete mostrando la medida.',
    badTip:
      'Foto sin regla, o regla en otra foto por separado, o medidas ilegibles.',
    critical: true,
  },
  {
    key: 'peso',
    title: '5. Paquete en báscula',
    hint:
      'El paquete final sobre una báscula con el peso legible en pantalla. ' +
      '⚠️ Sin esta foto NO se paga reclamo por sobrepesos.',
    goodTip: 'Peso claro en pantalla + paquete sobre la báscula.',
    badTip: 'Báscula sin paquete, o pantalla apagada, o peso ilegible.',
    critical: true,
  },
];

const MAX_SIZE = 8 * 1024 * 1024; // 8 MB

const errorText = (err, defaultMsg) => {
  const map = {
    invalid_slot: 'Slot inválido.',
    invalid_type: 'Formato no soportado. Usa JPG, PNG o WebP.',
    too_large: 'Foto demasiado grande. Máximo 8 MB.',
    no_file: 'Selecciona una foto.',
    unauthorized: 'Sesión expirada. Vuelve a iniciar sesión.',
    not_provider: 'Solo el vendedor de esta orden puede subir fotos.',
    transaction_not_found: 'La orden no existe.',
    r2_not_configured: 'Servicio de almacenamiento no disponible. Contáctanos.',
    upload_failed: 'No pudimos guardar la foto. Intenta de nuevo.',
  };
  return map[err] || defaultMsg || 'No pudimos subir la foto.';
};

const SosPhotoSlot = ({ slot, transactionId, currentUrl, onUploaded }) => {
  const inputRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);
  const [showTips, setShowTips] = useState(false);

  const doUpload = async file => {
    if (!file) return;
    if (file.size > MAX_SIZE) {
      setError('Foto demasiado grande. Máximo 8 MB.');
      return;
    }
    setError(null);
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const url = `${apiBaseUrl()}/api/upload-sos-photo?transactionId=${encodeURIComponent(
        transactionId
      )}&slot=${encodeURIComponent(slot.key)}`;
      const res = await fetch(url, { method: 'POST', body: form, credentials: 'include' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(errorText(data.error));
        return;
      }
      onUploaded(data.url);
    } catch (e) {
      setError('Fallo de red al subir la foto.');
    } finally {
      setUploading(false);
    }
  };

  const onFile = e => {
    const file = e.target.files?.[0];
    if (file) doUpload(file);
    e.target.value = '';
  };

  return (
    <div
      className={classNames(css.slot, {
        [css.slotDone]: !!currentUrl && !error,
        [css.slotCritical]: slot.critical,
      })}
    >
      <div className={css.slotHeader}>
        <h5 className={css.slotTitle}>{slot.title}</h5>
        {currentUrl ? <span className={css.slotBadgeDone}>✓ Lista</span> : null}
      </div>
      <p className={css.slotHint}>{slot.hint}</p>

      {currentUrl ? (
        <div className={css.preview}>
          <img src={currentUrl} alt={slot.title} className={css.previewImg} />
          <button
            type="button"
            className={css.replaceBtn}
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
          >
            {uploading ? 'Subiendo…' : 'Reemplazar'}
          </button>
        </div>
      ) : (
        <button
          type="button"
          className={css.uploadBtn}
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
        >
          {uploading ? 'Subiendo…' : '📷 Subir foto'}
        </button>
      )}

      <button
        type="button"
        className={css.tipsToggle}
        onClick={() => setShowTips(s => !s)}
      >
        {showTips ? '− Ocultar tips' : '+ Ver ejemplos'}
      </button>
      {showTips ? (
        <div className={css.tips}>
          <p className={css.tipGood}>✅ {slot.goodTip}</p>
          <p className={css.tipBad}>❌ {slot.badTip}</p>
        </div>
      ) : null}

      {error ? <p className={css.error}>{error}</p> : null}

      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        onChange={onFile}
        className={css.hiddenInput}
      />
    </div>
  );
};

const SosPhotosUploader = ({ transactionId, initialUrls, onChange, className }) => {
  const [urls, setUrls] = useState(initialUrls || {});

  const handleSlotUploaded = (slotKey, url) => {
    setUrls(prev => {
      const next = { ...prev, [slotKey]: url };
      if (typeof onChange === 'function') onChange(next);
      return next;
    });
  };

  const completedCount = SLOTS.filter(s => urls[s.key]).length;
  const allDone = completedCount === SLOTS.length;

  return (
    <div className={classNames(css.root, className)}>
      <div className={css.summary}>
        <div>
          <h4 className={css.summaryTitle}>Fotos de evidencia SOS</h4>
          <p className={css.summarySubtitle}>
            Skydropx exige estas 5 fotos para que el seguro pague reclamos.{' '}
            <strong>Sin las 5, no podrás generar la guía.</strong>
          </p>
        </div>
        <div className={css.progress}>
          <span className={css.progressCount}>
            {completedCount} / {SLOTS.length}
          </span>
          <div className={css.progressBar}>
            <div
              className={css.progressFill}
              style={{ width: `${(completedCount / SLOTS.length) * 100}%` }}
            />
          </div>
          {allDone ? <span className={css.progressDone}>✓ Completo</span> : null}
        </div>
      </div>

      <div className={css.slotsGrid}>
        {SLOTS.map(slot => (
          <SosPhotoSlot
            key={slot.key}
            slot={slot}
            transactionId={transactionId}
            currentUrl={urls[slot.key]}
            onUploaded={url => handleSlotUploaded(slot.key, url)}
          />
        ))}
      </div>
    </div>
  );
};

export default SosPhotosUploader;
