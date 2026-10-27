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

// XOLOLO Fase 2: slots divididos en 2 etapas.
// PRE_SLOTS (4): antes de generar la guía.
// POST_SLOTS (1): foto de guía pegada — después de generar la guía
//   (antes se pedía como requisito pre-guía, lo cual era imposible).
const PRE_SLOTS = [
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
    key: 'medidas',
    title: '3. Paquete con regla o flexómetro',
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
    title: '4. Paquete en báscula',
    hint:
      'El paquete final sobre una báscula con el peso legible en pantalla. ' +
      '⚠️ Sin esta foto NO se paga reclamo por sobrepesos.',
    goodTip: 'Peso claro en pantalla + paquete sobre la báscula.',
    badTip: 'Báscula sin paquete, o pantalla apagada, o peso ilegible.',
    critical: true,
  },
];

const POST_SLOTS = [
  {
    key: 'guia',
    title: '5. Guía adherida al paquete',
    hint:
      'Imprime la guía generada arriba, pégala al paquete y toma esta foto ' +
      'con el tracking legible.',
    goodTip: 'Se lee claramente el tracking number.',
    badTip: 'Guía borrosa, doblada o sin pegar todavía.',
  },
];

const SLOTS = [...PRE_SLOTS, ...POST_SLOTS];

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

const SosPhotosUploader = ({
  transactionId,
  initialUrls,
  onChange,
  className,
  // XOLOLO Fase 2:
  insuranceAccepted = false, // ¿el buyer contrató SOS?
  labelGenerated = false, // ¿ya se generó la guía?
}) => {
  const [urls, setUrls] = useState(initialUrls || {});

  const handleSlotUploaded = (slotKey, url) => {
    setUrls(prev => {
      const next = { ...prev, [slotKey]: url };
      if (typeof onChange === 'function') onChange(next);
      return next;
    });
  };

  const preCompleted = PRE_SLOTS.filter(s => urls[s.key]).length;
  const postCompleted = POST_SLOTS.filter(s => urls[s.key]).length;
  const allDone = preCompleted + postCompleted === SLOTS.length;

  const subtitle = insuranceAccepted ? (
    <>
      El buyer contrató Protección SOS. Estas fotos son <strong>requisito</strong>{' '}
      para generar la guía y para que Skydropx pague cualquier reclamo.
    </>
  ) : (
    <>
      El buyer <strong>no</strong> contrató Protección SOS, así que estas fotos son{' '}
      <strong>opcionales</strong>. Pero las recomendamos: te sirven de evidencia
      si hay disputa con la paquetería o un contracargo bancario.
    </>
  );

  return (
    <div className={classNames(css.root, className)}>
      <div className={css.summary}>
        <div>
          <h4 className={css.summaryTitle}>Fotos de evidencia SOS</h4>
          <p className={css.summarySubtitle}>{subtitle}</p>
        </div>
        <div className={css.progress}>
          <span className={css.progressCount}>
            {preCompleted + postCompleted} / {SLOTS.length}
          </span>
          <div className={css.progressBar}>
            <div
              className={css.progressFill}
              style={{
                width: `${((preCompleted + postCompleted) / SLOTS.length) * 100}%`,
              }}
            />
          </div>
          {allDone ? <span className={css.progressDone}>✓ Completo</span> : null}
        </div>
      </div>

      <h5 className={css.stageHeader}>Antes de generar la guía</h5>
      <div className={css.slotsGrid}>
        {PRE_SLOTS.map(slot => (
          <SosPhotoSlot
            key={slot.key}
            slot={slot}
            transactionId={transactionId}
            currentUrl={urls[slot.key]}
            onUploaded={url => handleSlotUploaded(slot.key, url)}
          />
        ))}
      </div>

      <h5 className={css.stageHeader}>
        Después de generar e imprimir la guía
        {!labelGenerated ? (
          <span className={css.stageHint}>
            {' '}
            — habilitado una vez que generes la guía
          </span>
        ) : null}
      </h5>
      <div className={css.slotsGrid}>
        {POST_SLOTS.map(slot => (
          <div
            key={slot.key}
            className={classNames({ [css.slotLocked]: !labelGenerated })}
          >
            <SosPhotoSlot
              slot={slot}
              transactionId={transactionId}
              currentUrl={urls[slot.key]}
              onUploaded={url => handleSlotUploaded(slot.key, url)}
            />
          </div>
        ))}
      </div>
    </div>
  );
};

export default SosPhotosUploader;
