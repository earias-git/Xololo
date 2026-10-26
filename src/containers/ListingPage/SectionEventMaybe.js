import React from 'react';

import css from './ListingPage.module.css';

// XOLOLO: banner prominente para listings tipo "Evento con fecha fija"
// (publicData.isEvent === true). Si no es evento, no renderiza nada.
//
// Muestra: fecha + hora, lugar con link a Google Maps, modalidad,
// cupo restante (= stock del listing), qué incluye, edad mínima.
//
// El cupo restante se calcula desde `currentStock` del listing (que ya
// Sharetribe decrementa cuando se cierran transacciones de compra).

const MONTHS_ES = [
  'ene', 'feb', 'mar', 'abr', 'may', 'jun',
  'jul', 'ago', 'sep', 'oct', 'nov', 'dic',
];
const DAYS_ES = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];

// "2026-10-30" + "11:00" → "Viernes 30 oct 2026 · 11:00"
// Si hay fecha_fin distinta → "... – Sábado 31 oct 2026 · 18:00"
const formatEventWhen = ({ date_start, time_start, date_end, time_end }) => {
  const parsePart = (d, t) => {
    if (!d) return null;
    try {
      const [y, m, day] = d.split('-').map(Number);
      if (!y || !m || !day) return null;
      const dt = new Date(Date.UTC(y, m - 1, day));
      const dayLabel = `${DAYS_ES[dt.getUTCDay()]} ${day} ${MONTHS_ES[m - 1]} ${y}`;
      return t ? `${dayLabel} · ${t}` : dayLabel;
    } catch (_) {
      return null;
    }
  };
  const start = parsePart(date_start, time_start);
  const end = parsePart(date_end, time_end);
  if (!start) return null;
  if (!end) return start;
  if (date_start === date_end) {
    // Mismo día — mostrar fecha + rango de hora: "Vie 30 oct 2026 · 11:00 – 14:00"
    return `${start} – ${time_end}`;
  }
  return `${start} – ${end}`;
};

const buildMapsLink = location => {
  if (!location) return null;
  return `https://maps.google.com/?q=${encodeURIComponent(location)}`;
};

const SectionEventMaybe = props => {
  const { publicData, currentStock } = props;
  if (!publicData?.isEvent || !publicData?.event) return null;
  const ev = publicData.event;

  const when = formatEventWhen(ev);
  const mapsLink = buildMapsLink(ev.location);
  const capacity = Number(ev.capacity || 0);
  const seatsLeft = Number.isFinite(currentStock) ? currentStock : capacity;
  const soldOut = capacity > 0 && seatsLeft <= 0;

  return (
    <section className={css.eventBanner} aria-label="Detalles del evento">
      <header className={css.eventBannerHeader}>
        <span className={css.eventBannerBadge}>🎫 EVENTO</span>
        {ev.modality ? <span className={css.eventBannerModality}>{ev.modality}</span> : null}
      </header>

      {when ? (
        <p className={css.eventBannerWhen}>
          📅 <strong>{when}</strong>
        </p>
      ) : null}

      {ev.location ? (
        <p className={css.eventBannerWhere}>
          📍{' '}
          {mapsLink ? (
            <a href={mapsLink} target="_blank" rel="noreferrer">
              {ev.location}
            </a>
          ) : (
            ev.location
          )}
        </p>
      ) : null}

      {capacity > 0 ? (
        <p className={soldOut ? css.eventBannerSoldOut : css.eventBannerSeats}>
          🎫{' '}
          {soldOut
            ? 'Agotado'
            : `${seatsLeft} ${seatsLeft === 1 ? 'lugar disponible' : 'lugares disponibles'} de ${capacity}`}
        </p>
      ) : null}

      {ev.includes ? (
        <p className={css.eventBannerIncludes}>
          <strong>Incluye:</strong> {ev.includes}
        </p>
      ) : null}

      {ev.min_age ? (
        <p className={css.eventBannerMinAge}>
          <strong>Edad mínima:</strong> {ev.min_age} años
        </p>
      ) : null}
    </section>
  );
};

export default SectionEventMaybe;
