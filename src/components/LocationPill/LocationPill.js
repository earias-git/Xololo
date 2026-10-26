import React, { useEffect, useRef, useState } from 'react';

import { useBuyerLocation } from '../../hooks/useBuyerLocation';

import css from './LocationPill.module.css';

// XOLOLO Task #17: pill clickeable con la ubicación actual del buyer.
// Al abrir el popover, el buyer puede escribir su CP (5 dígitos) para
// corregir la detección por IP o para fijar manualmente su ubicación.
// Si no hay location aún, muestra "Elegir ubicación".
//
// Props: none — el componente lee useBuyerLocation internamente para
// evitar prop-drilling desde Topbar.
const LocationPill = () => {
  const { location, resolveAndSave, clearLocation } = useBuyerLocation();
  const [open, setOpen] = useState(false);
  const [cp, setCp] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const panelRef = useRef(null);

  // Cerrar al clickear afuera o presionar Esc.
  useEffect(() => {
    if (!open) return undefined;
    const onDoc = e => {
      if (panelRef.current && !panelRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    const onEsc = e => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onEsc);
    };
  }, [open]);

  const label = location?.city || location?.state || 'Elegir ubicación';

  const handleSubmit = async e => {
    e.preventDefault();
    setError(null);
    if (!/^\d{5}$/.test(cp)) {
      setError('Ingresa un CP de 5 dígitos.');
      return;
    }
    setSubmitting(true);
    const resolved = await resolveAndSave(cp);
    setSubmitting(false);
    if (!resolved) {
      setError('No pudimos resolver ese CP. Intenta otro.');
      return;
    }
    setCp('');
    setOpen(false);
  };

  const handleClear = () => {
    clearLocation();
    setCp('');
    setError(null);
    setOpen(false);
  };

  return (
    <div className={css.wrapper} ref={panelRef}>
      <button
        type="button"
        className={css.pill}
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={`Ubicación: ${label}. Clic para cambiar.`}
      >
        <span className={css.pin} aria-hidden="true">📍</span>
        <span className={css.labelText}>{label}</span>
      </button>

      {open ? (
        <div className={css.panel} role="dialog" aria-label="Cambiar ubicación">
          <p className={css.panelTitle}>Tu ubicación</p>
          <p className={css.panelHelp}>
            Ingresa tu código postal para que te mostremos lo más cercano a ti.
          </p>
          <form onSubmit={handleSubmit}>
            <div className={css.inputRow}>
              <input
                type="text"
                inputMode="numeric"
                autoComplete="postal-code"
                maxLength={5}
                className={`${css.input} ${error ? css.error : ''}`}
                placeholder="62000"
                value={cp}
                onChange={e => setCp(e.target.value.replace(/\D/g, ''))}
                aria-label="Código postal"
                aria-invalid={!!error}
              />
              <button type="submit" className={css.submitBtn} disabled={submitting}>
                {submitting ? '…' : 'Guardar'}
              </button>
            </div>
            {error ? <p className={css.errorMsg} role="alert">{error}</p> : null}
          </form>
          {location ? (
            <div className={css.clearRow}>
              <button type="button" className={css.clearBtn} onClick={handleClear}>
                Quitar ubicación
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};

export default LocationPill;
