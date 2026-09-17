import React, { useRef, useState } from 'react';
import { Field } from 'react-final-form';
import classNames from 'classnames';

import { apiBaseUrl } from '../../../util/api';

import css from './ImageUploadField.module.css';

// XOLOLO: campo para subir logo o banner de la tienda del seller.
// Sube el archivo al endpoint /api/upload-store-image (Cloudflare R2) y
// guarda la URL pública en el Final Form field. Muestra preview, permite
// re-subir o quitar la imagen. Fallback: link "pegar URL externa" para
// quien ya tenga la imagen hospedada.

const ALLOWED_EXT = 'image/png,image/jpeg,image/webp';
const MAX_SIZE = 5 * 1024 * 1024; // 5 MB

const ERROR_MESSAGES = {
  no_file: 'Selecciona un archivo primero.',
  too_large: 'La imagen es demasiado grande. Máx 5 MB.',
  invalid_type: 'Formato no soportado. Usa PNG, JPG o WebP.',
  invalid_kind: 'Tipo de imagen inválido.',
  unauthorized: 'Tu sesión expiró. Vuelve a iniciar sesión.',
  r2_not_configured: 'El servicio de imágenes no está configurado. Contáctanos.',
  upload_failed: 'No pudimos subir la imagen. Intenta de nuevo.',
  network: 'Fallo de red al subir la imagen. Revisa tu conexión.',
};

const ImageUploadField = ({ name, kind, label, hint, aspectRatio }) => {
  const fileInputRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);
  const [showUrlInput, setShowUrlInput] = useState(false);

  return (
    <Field name={name}>
      {({ input }) => {
        const currentUrl = input.value || '';

        const clearError = () => setError(null);

        const doUpload = async file => {
          if (!file) return;
          clearError();
          setUploading(true);
          const form = new FormData();
          form.append('file', file);
          try {
            const res = await fetch(
              `${apiBaseUrl()}/api/upload-store-image?kind=${encodeURIComponent(kind)}`,
              {
                method: 'POST',
                body: form,
                credentials: 'include',
              }
            );
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
              setError(ERROR_MESSAGES[data.error] || ERROR_MESSAGES.upload_failed);
              return;
            }
            if (data.url) {
              input.onChange(data.url);
            }
          } catch (err) {
            setError(ERROR_MESSAGES.network);
          } finally {
            setUploading(false);
          }
        };

        const onFileChange = e => {
          const file = e.target.files?.[0];
          if (file && file.size > MAX_SIZE) {
            setError(ERROR_MESSAGES.too_large);
            e.target.value = '';
            return;
          }
          doUpload(file);
          e.target.value = ''; // permite re-subir el mismo archivo
        };

        const onDrop = e => {
          e.preventDefault();
          const file = e.dataTransfer.files?.[0];
          if (!file) return;
          if (file.size > MAX_SIZE) {
            setError(ERROR_MESSAGES.too_large);
            return;
          }
          if (!ALLOWED_EXT.split(',').includes(file.type)) {
            setError(ERROR_MESSAGES.invalid_type);
            return;
          }
          doUpload(file);
        };

        const onDragOver = e => {
          e.preventDefault();
        };

        const removeImage = () => {
          input.onChange('');
          clearError();
        };

        const openPicker = () => {
          clearError();
          fileInputRef.current?.click();
        };

        const previewStyle = aspectRatio
          ? { aspectRatio, background: '#f7f4ee' }
          : undefined;

        return (
          <div className={css.wrap}>
            <label className={css.label}>{label}</label>

            <div
              className={classNames(css.dropzone, {
                [css.dropzoneHasImage]: !!currentUrl,
                [css.dropzoneBanner]: kind === 'banner',
              })}
              onDrop={onDrop}
              onDragOver={onDragOver}
              style={previewStyle}
            >
              {currentUrl ? (
                <img
                  src={currentUrl}
                  alt={`Preview ${kind}`}
                  className={kind === 'banner' ? css.previewBanner : css.previewLogo}
                />
              ) : (
                <div className={css.dropzoneEmpty}>
                  <span className={css.dropzoneIcon} aria-hidden="true">📁</span>
                  <p className={css.dropzoneText}>
                    Arrastra tu imagen aquí o{' '}
                    <button type="button" onClick={openPicker} className={css.dropzoneBtn}>
                      elige un archivo
                    </button>
                  </p>
                  <p className={css.dropzoneHint}>PNG, JPG o WebP · máx 5 MB</p>
                </div>
              )}

              {uploading ? (
                <div className={css.uploadingOverlay}>
                  <span className={css.spinner} aria-label="Subiendo…" />
                  <span className={css.uploadingText}>Subiendo…</span>
                </div>
              ) : null}
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept={ALLOWED_EXT}
              onChange={onFileChange}
              hidden
              aria-hidden="true"
            />

            <div className={css.actions}>
              {currentUrl ? (
                <>
                  <button type="button" className={css.actionBtn} onClick={openPicker}>
                    Cambiar imagen
                  </button>
                  <button
                    type="button"
                    className={classNames(css.actionBtn, css.actionBtnDanger)}
                    onClick={removeImage}
                  >
                    Quitar
                  </button>
                </>
              ) : (
                <button type="button" className={css.actionBtn} onClick={openPicker}>
                  Elegir archivo
                </button>
              )}
              <button
                type="button"
                className={css.actionLink}
                onClick={() => setShowUrlInput(o => !o)}
              >
                {showUrlInput ? 'Ocultar URL externa' : 'O pega una URL externa'}
              </button>
            </div>

            {showUrlInput ? (
              <input
                type="text"
                placeholder="https://..."
                className={css.urlInput}
                value={currentUrl}
                onChange={e => input.onChange(e.target.value)}
                spellCheck={false}
              />
            ) : null}

            {hint ? <p className={css.hint}>{hint}</p> : null}
            {error ? <p className={css.error}>{error}</p> : null}
          </div>
        );
      }}
    </Field>
  );
};

export default ImageUploadField;
