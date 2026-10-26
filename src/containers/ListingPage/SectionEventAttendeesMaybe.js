import React, { useCallback, useEffect, useState } from 'react';

import { apiBaseUrl } from '../../util/api';

import css from './ListingPage.module.css';

// XOLOLO: panel de asistentes confirmados a un evento.
// Visible SÓLO para el seller dueño del listing (prop isOwner),
// SÓLO si publicData.isEvent === true. Hace fetch autenticado a
// /api/seller-event-attendees?listingId=X.
//
// Muestra: cabecera con progreso cupo (N / capacidad), tabla con
// nombre, email, # boletos, monto pagado, fecha de compra. Botón
// "Descargar CSV" para que el seller tenga la lista en Excel/imprimir
// para la puerta del evento.

const formatDate = iso => {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('es-MX', {
      year: 'numeric', month: 'short', day: '2-digit',
    });
  } catch (_) {
    return iso.slice(0, 10);
  }
};

const toCsv = (attendees, eventTitle) => {
  const header = ['Nombre', 'Email', 'Boletos', 'Monto MXN', 'Fecha compra', 'Tx ID'];
  const rows = attendees.map(a => [
    a.buyerName || '',
    a.buyerEmail || '',
    String(a.quantity || 1),
    String(a.totalPaidMxn || 0),
    a.purchasedAt ? new Date(a.purchasedAt).toLocaleString('es-MX') : '',
    a.txId || '',
  ]);
  const escape = v => {
    const s = String(v ?? '').replace(/"/g, '""');
    return /[",\n]/.test(s) ? `"${s}"` : s;
  };
  const lines = [header, ...rows].map(r => r.map(escape).join(','));
  return `# Asistentes · ${eventTitle || ''}\n${lines.join('\n')}\n`;
};

const downloadCsv = (text, filename) => {
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

const SectionEventAttendeesMaybe = props => {
  const { listing, isOwner } = props;
  const publicData = listing?.attributes?.publicData || {};
  const isEvent = publicData?.isEvent === true;
  const listingId = listing?.id?.uuid;

  const [state, setState] = useState({
    loading: false,
    settled: false,
    data: null,
    error: null,
  });
  const [sendingTxId, setSendingTxId] = useState(null);

  const load = useCallback(async () => {
    if (!listingId) return;
    setState({ loading: true, settled: false, data: null, error: null });
    try {
      const res = await fetch(
        `${apiBaseUrl()}/api/seller-event-attendees?listingId=${encodeURIComponent(listingId)}`,
        { credentials: 'include' }
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setState({
          loading: false,
          settled: true,
          data: null,
          error: data?.error || `http_${res.status}`,
          errorHint: data?.hint || null,
        });
        return;
      }
      const data = await res.json();
      setState({ loading: false, settled: true, data, error: null, errorHint: null });
    } catch (e) {
      setState({ loading: false, settled: true, data: null, error: e?.message || 'network' });
    }
  }, [listingId]);

  useEffect(() => {
    if (isEvent && isOwner && listingId) load();
  }, [isEvent, isOwner, listingId, load]);

  const sendTicket = async txId => {
    setSendingTxId(txId);
    try {
      const res = await fetch(`${apiBaseUrl()}/api/seller-event-ticket-send`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ txId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(`No se pudo enviar: ${data?.error || res.status}${data?.details ? '\n' + data.details : ''}`);
      } else {
        alert(`Boleto enviado a ${data.sentTo}.`);
      }
    } catch (e) {
      alert(`Error: ${e?.message || 'network'}`);
    } finally {
      setSendingTxId(null);
    }
  };

  // Guard: no renderiza nada si no es evento o no es el owner.
  if (!isEvent || !isOwner) return null;

  // ticket_qr flag en publicData.event. Si está activo, mostramos botón
  // "Enviar boleto" por fila; si no, el seller usa la lista de nombres.
  const ticketQrEnabled = publicData.event?.ticket_qr === true;
  const d = state.data;
  const attendees = d?.attendees || [];
  const capacity = Number(d?.capacity || 0);
  const seatsLeft = capacity > 0 ? Math.max(0, capacity - (d?.totalSeats || 0)) : null;

  return (
    <section className={css.attendeesPanel} aria-label="Asistentes confirmados">
      <header className={css.attendeesHeader}>
        <h3 className={css.attendeesTitle}>👥 Asistentes confirmados</h3>
        <div className={css.attendeesHeaderRight}>
          {capacity > 0 ? (
            <span className={css.attendeesCount}>
              {d?.totalSeats || 0} / {capacity} boletos
              {seatsLeft !== null ? ` · quedan ${seatsLeft}` : ''}
            </span>
          ) : null}
          {d && attendees.length > 0 ? (
            <button
              type="button"
              className={css.attendeesCsvBtn}
              onClick={() => downloadCsv(
                toCsv(attendees, d.eventTitle),
                `asistentes-${d.eventDate || 'evento'}.csv`
              )}
            >
              📥 Descargar CSV
            </button>
          ) : null}
          <button
            type="button"
            className={css.attendeesReloadBtn}
            onClick={load}
            disabled={state.loading}
          >
            {state.loading ? '…' : '↻'}
          </button>
        </div>
      </header>

      <p className={css.attendeesLead}>
        Vista exclusiva para ti como organizador. Imprime o descarga la lista
        y marca a cada persona en la puerta del evento. Sólo tú ves esta
        sección — el buyer no.
      </p>

      {state.loading ? (
        <p className={css.attendeesStatus}>Cargando asistentes…</p>
      ) : state.error ? (
        <div className={css.attendeesStatus}>
          <p style={{ margin: 0 }}>Error al cargar: {state.error}</p>
          {state.errorHint ? (
            <p style={{ margin: '6px 0 0', fontSize: '12.5px', color: '#777' }}>
              {state.errorHint}
            </p>
          ) : null}
        </div>
      ) : attendees.length === 0 ? (
        <p className={css.attendeesEmpty}>
          Aún no hay boletos vendidos. Cuando alguien compre, aparecerá aquí
          automáticamente.
        </p>
      ) : (
        <table className={css.attendeesTable}>
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Email</th>
              <th>Boletos</th>
              <th>Pagó</th>
              <th>Compró</th>
              {ticketQrEnabled ? <th>Boleto QR</th> : null}
            </tr>
          </thead>
          <tbody>
            {attendees.map((a, i) => (
              <tr key={a.txId || i}>
                <td className={css.attendeesName}>{a.buyerName}</td>
                <td className={css.attendeesEmail}>{a.buyerEmail || '—'}</td>
                <td>{a.quantity}</td>
                <td>${a.totalPaidMxn} MXN</td>
                <td>{formatDate(a.purchasedAt)}</td>
                {ticketQrEnabled ? (
                  <td>
                    <button
                      type="button"
                      className={css.attendeesSendBtn}
                      disabled={sendingTxId === a.txId || !a.buyerEmail}
                      onClick={() => sendTicket(a.txId)}
                      title={!a.buyerEmail ? 'Falta email del buyer' : ''}
                    >
                      {sendingTxId === a.txId ? 'Enviando…' : '📧 Enviar / reenviar'}
                    </button>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
};

export default SectionEventAttendeesMaybe;
