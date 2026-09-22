import React, { useState } from 'react';
import classNames from 'classnames';

import { apiBaseUrl } from '../../util/api';
import SosPhotosUploader from '../SosPhotosUploader/SosPhotosUploader';

import css from './OrderFulfillmentPanel.module.css';

// XOLOLO: panel de fulfillment que aparece en la TransactionPage cuando
// el user logueado es el PROVIDER (seller). Solo se muestra si la orden
// tiene modo carrier con rate seleccionado. Guía al seller por los pasos:
//
//   Paso 1: Confirmar que empieza a preparar el pedido
//   Paso 2: Subir las 5 fotos SOS
//   Paso 3: Generar guía Skydropx (llama /api/generate-shipping-guide)
//   Paso 4: Descargar el PDF de la guía + tracking url
//
// El panel se auto-hidrata de la transacción:
// - fotos SOS: tx.metadata.xololoShippingSosPhotos
// - guía generada: tx.metadata.xololoShippingGuide
// - shipping mode + rate: tx.protectedData.xololoShipping
//
// Cuando la guía ya existe (guide.shipmentId presente), se colapsan los
// pasos anteriores y solo se muestra el CTA "Ver / descargar guía".

const OrderFulfillmentPanel = ({ transaction, className }) => {
  const attrs = transaction?.attributes || {};
  const metadata = attrs.metadata || {};
  const protectedData = attrs.protectedData || {};
  const xShipping = protectedData.xololoShipping || {};
  const initialSosPhotos = metadata.xololoShippingSosPhotos || {};
  const existingGuide = metadata.xololoShippingGuide;

  const [sosPhotos, setSosPhotos] = useState(initialSosPhotos);
  const [guide, setGuide] = useState(existingGuide || null);
  const [generatingGuide, setGeneratingGuide] = useState(false);
  const [generationError, setGenerationError] = useState(null);
  const [generationErrorDetails, setGenerationErrorDetails] = useState(null);
  const [started, setStarted] = useState(!!initialSosPhotos.producto || !!existingGuide);

  // Solo carrier + rate elegido → aplicamos este flujo.
  if (xShipping.mode !== 'carrier' || !xShipping.rate?.id) {
    return null;
  }

  const requiredSlots = ['producto', 'embalado', 'guia', 'medidas', 'peso'];
  const completedPhotos = requiredSlots.filter(k => sosPhotos[k]).length;
  const allPhotosDone = completedPhotos === requiredSlots.length;

  const handleGenerate = async () => {
    setGenerationError(null);
    setGenerationErrorDetails(null);
    setGeneratingGuide(true);
    try {
      const res = await fetch(`${apiBaseUrl()}/api/generate-shipping-guide`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ transactionId: transaction.id.uuid }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const map = {
          not_shippable: 'Esta orden no es cotizable por paquetería.',
          no_rate_selected: 'El buyer aún no eligió paquetería.',
          already_generated: 'La guía ya fue generada.',
          sos_photos_missing: 'Faltan fotos SOS. Sube las 5 antes de generar.',
          seller_address_incomplete:
            'Tu domicilio de recolección está incompleto. Actualízalo en /account/store.',
          buyer_address_incomplete: 'La dirección del comprador está incompleta.',
          skydropx_rejected: 'Skydropx rechazó la guía. Detalle abajo.',
          label_timeout:
            'La guía se creó pero el PDF tarda. Recarga esta página en un minuto.',
        };
        setGenerationError(map[data.error] || 'No pudimos generar la guía.');
        // XOLOLO: guardamos el detail crudo del server (Skydropx errors,
        // missing fields, etc.) para exponerlo en el UI. Ayuda a debuggear
        // sin depender de los logs de Render.
        if (data.details || data.missing) {
          setGenerationErrorDetails(data.details || data.missing || null);
        }
        // El caso already_generated devuelve la guía en el response.
        if (data.error === 'already_generated' && data.guide) setGuide(data.guide);
        return;
      }
      setGuide(data);
    } catch (e) {
      setGenerationError('Fallo de red al generar la guía.');
    } finally {
      setGeneratingGuide(false);
    }
  };

  // ---------- Vista cuando la guía YA existe: solo mostrar el enlace ----------
  if (guide?.shipmentId) {
    return (
      <section className={classNames(css.root, className)}>
        <div className={css.header}>
          <h3 className={css.title}>✓ Guía lista para imprimir</h3>
          <p className={css.subtitle}>
            {guide.carrierName?.toUpperCase()} · {guide.serviceName} · Tracking{' '}
            <code>{guide.trackingNumber}</code>
          </p>
        </div>
        <div className={css.ctaRow}>
          {guide.labelUrl ? (
            <a
              className={css.primaryCta}
              href={guide.labelUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              📄 Descargar / Imprimir guía (PDF)
            </a>
          ) : null}
          {guide.trackingUrl ? (
            <a
              className={css.secondaryCta}
              href={guide.trackingUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              Ver tracking en {guide.carrierName?.toUpperCase()}
            </a>
          ) : null}
        </div>
        <p className={css.tinyHint}>
          Pega la guía impresa en el paquete siguiendo la Foto 3 que subiste, y
          entrégalo al chofer del courier cuando pase a recoger.
        </p>
      </section>
    );
  }

  // ---------- Vista de flujo activo ----------
  return (
    <section className={classNames(css.root, className)}>
      <div className={css.header}>
        <h3 className={css.title}>Preparar envío</h3>
        <p className={css.subtitle}>
          El buyer eligió {xShipping.rate.carrier} · {xShipping.rate.service}. Sigue
          los pasos para generar la guía.
        </p>
      </div>

      {/* Paso 1: Confirmar inicio */}
      <div
        className={classNames(css.step, {
          [css.stepDone]: started,
          [css.stepActive]: !started,
        })}
      >
        <div className={css.stepHeader}>
          <span className={css.stepNumber}>1</span>
          <h4 className={css.stepTitle}>Empezar a preparar</h4>
        </div>
        {!started ? (
          <>
            <p className={css.stepBody}>
              Al confirmar, el buyer recibe una notificación "Tu vendedor está
              preparando tu pedido" y el timeline avanza.
            </p>
            <button
              type="button"
              className={css.primaryCta}
              onClick={() => setStarted(true)}
            >
              Sí, empiezo a preparar
            </button>
          </>
        ) : (
          <p className={css.stepDoneMsg}>✓ Confirmado</p>
        )}
      </div>

      {/* Paso 2: 5 fotos SOS */}
      {started ? (
        <div
          className={classNames(css.step, {
            [css.stepDone]: allPhotosDone,
            [css.stepActive]: !allPhotosDone,
          })}
        >
          <div className={css.stepHeader}>
            <span className={css.stepNumber}>2</span>
            <h4 className={css.stepTitle}>Fotos de evidencia SOS</h4>
          </div>
          <SosPhotosUploader
            transactionId={transaction.id.uuid}
            initialUrls={sosPhotos}
            onChange={setSosPhotos}
          />
        </div>
      ) : null}

      {/* Paso 3: Generar guía */}
      {started ? (
        <div
          className={classNames(css.step, {
            [css.stepActive]: allPhotosDone,
            [css.stepBlocked]: !allPhotosDone,
          })}
        >
          <div className={css.stepHeader}>
            <span className={css.stepNumber}>3</span>
            <h4 className={css.stepTitle}>Generar guía Skydropx</h4>
          </div>
          {allPhotosDone ? (
            <>
              <p className={css.stepBody}>
                Al generarla se crea la etiqueta PDF con {xShipping.rate.carrier} y
                se activa el seguro SOS Protección hasta $100,000.
              </p>
              <button
                type="button"
                className={css.primaryCta}
                onClick={handleGenerate}
                disabled={generatingGuide}
              >
                {generatingGuide ? 'Generando…' : 'Generar guía'}
              </button>
              {generationError ? (
                <>
                  <p className={css.stepError}>{generationError}</p>
                  {generationErrorDetails ? (
                    <details className={css.stepErrorDetails}>
                      <summary>Ver detalle técnico</summary>
                      <pre>
                        {typeof generationErrorDetails === 'string'
                          ? generationErrorDetails
                          : JSON.stringify(generationErrorDetails, null, 2)}
                      </pre>
                    </details>
                  ) : null}
                </>
              ) : null}
            </>
          ) : (
            <p className={css.stepBody}>
              Sube las 5 fotos SOS del paso anterior para desbloquear este paso.
            </p>
          )}
        </div>
      ) : null}
    </section>
  );
};

export default OrderFulfillmentPanel;
