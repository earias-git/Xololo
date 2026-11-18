// XOLOLO 2026-11-18 — módulo OPS Notificaciones.
//
// Permite al operador enviar emails ad-hoc a sellers/users:
// - Selecciona una plantilla (o parte de cero).
// - Llena placeholders (name, listingTitle, listingUrl, etc.).
// - Edita subject y body antes de enviar.
// - Click Enviar → POST /api/admin/ops/send-notification.
// - Historial de los últimos 100 envíos (in-memory server).
//
// Las plantillas son config como código (server/api-util/notifications/opsTemplates.js)
// — no se editan desde UI, por diseño.

import React, { useEffect, useState, useCallback } from 'react';
import { apiBaseUrl } from '../../util/api';

const PLACEHOLDER_RE = /\{\{(\w+)\}\}/g;

const substitute = (text, values) =>
  text.replace(PLACEHOLDER_RE, (_, key) =>
    values[key] != null && values[key] !== '' ? String(values[key]) : `{{${key}}}`
  );

const detectPlaceholders = text => {
  const set = new Set();
  let m;
  while ((m = PLACEHOLDER_RE.exec(text)) !== null) set.add(m[1]);
  PLACEHOLDER_RE.lastIndex = 0;
  return Array.from(set);
};

const NotificationsView = ({ onBack }) => {
  const [templates, setTemplates] = useState([]);
  const [placeholdersCatalog, setPlaceholdersCatalog] = useState([]);
  const [log, setLog] = useState([]);
  const [loading, setLoading] = useState(true);

  const [selectedTplId, setSelectedTplId] = useState('libre');
  const [placeholderValues, setPlaceholderValues] = useState({});
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState(null);

  // XOLOLO 2026-11-18 — autocomplete user + listings.
  const [userQuery, setUserQuery] = useState('');
  const [userSuggestions, setUserSuggestions] = useState([]);
  const [searchingUsers, setSearchingUsers] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedUser, setSelectedUser] = useState(null);
  const [userListings, setUserListings] = useState([]);
  const [loadingListings, setLoadingListings] = useState(false);
  const [selectedListingId, setSelectedListingId] = useState('');

  const loadTemplates = useCallback(async () => {
    const r = await fetch(`${apiBaseUrl()}/api/admin/ops/notification-templates`, {
      credentials: 'include',
    });
    if (r.ok) {
      const data = await r.json();
      setTemplates(data.templates || []);
      setPlaceholdersCatalog(data.placeholders || []);
    }
  }, []);

  const loadLog = useCallback(async () => {
    const r = await fetch(`${apiBaseUrl()}/api/admin/ops/send-notification/log`, {
      credentials: 'include',
    });
    if (r.ok) {
      const data = await r.json();
      setLog(data.log || []);
    }
  }, []);

  useEffect(() => {
    Promise.all([loadTemplates(), loadLog()]).finally(() => setLoading(false));
  }, [loadTemplates, loadLog]);

  // XOLOLO 2026-11-18 — debounced search. Al teclear 2+ chars,
  // consultar el endpoint de autocomplete 350ms después de la
  // última tecla.
  useEffect(() => {
    if (userQuery.length < 2) {
      setUserSuggestions([]);
      return undefined;
    }
    let cancelled = false;
    setSearchingUsers(true);
    const handle = setTimeout(async () => {
      try {
        const r = await fetch(
          `${apiBaseUrl()}/api/admin/ops/notification-users-search?q=${encodeURIComponent(
            userQuery
          )}&limit=10`,
          { credentials: 'include' }
        );
        if (!cancelled && r.ok) {
          const data = await r.json();
          setUserSuggestions(data.users || []);
        }
      } catch (_) {
        if (!cancelled) setUserSuggestions([]);
      } finally {
        if (!cancelled) setSearchingUsers(false);
      }
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [userQuery]);

  // Al seleccionar un user del autocomplete: setear `to`,
  // `{{name}}`, y pedir sus listings.
  const handleSelectUser = async user => {
    setSelectedUser(user);
    setTo(user.email || '');
    setUserQuery(user.email || user.displayName || '');
    setShowSuggestions(false);
    setPlaceholderValues(prev => ({
      ...prev,
      name: user.displayName || (user.email || '').split('@')[0] || '',
    }));
    setSelectedListingId('');
    setUserListings([]);
    setLoadingListings(true);
    try {
      const r = await fetch(
        `${apiBaseUrl()}/api/admin/ops/notification-user/${user.id}/listings`,
        { credentials: 'include' }
      );
      if (r.ok) {
        const data = await r.json();
        setUserListings(data.listings || []);
      }
    } catch (_) {
      // silencioso
    } finally {
      setLoadingListings(false);
    }
  };

  // Al seleccionar un listing del user, pre-llenar placeholders
  // {{listingTitle}}, {{listingUrl}}, {{expectedVariants}}.
  const handleSelectListing = listingId => {
    setSelectedListingId(listingId);
    const listing = userListings.find(l => l.id === listingId);
    if (!listing) return;
    setPlaceholderValues(prev => ({
      ...prev,
      listingTitle: listing.title || '',
      listingUrl: listing.editVariantsUrl || listing.url || '',
      expectedVariants: listing.expectedVariants
        ? String(listing.expectedVariants)
        : prev.expectedVariants || '',
    }));
  };

  const clearSelectedUser = () => {
    setSelectedUser(null);
    setUserListings([]);
    setSelectedListingId('');
    setUserQuery('');
    setTo('');
  };

  // Al cambiar plantilla, hidratar subject + body
  const applyTemplate = tplId => {
    setSelectedTplId(tplId);
    const tpl = templates.find(t => t.id === tplId);
    if (!tpl) return;
    setSubject(tpl.subject || '');
    setBody(tpl.bodyText || '');
    setSendResult(null);
    // Reset de placeholder values
    const placeholders = [
      ...detectPlaceholders(tpl.subject || ''),
      ...detectPlaceholders(tpl.bodyText || ''),
    ];
    const reset = {};
    placeholders.forEach(k => {
      reset[k] = '';
    });
    setPlaceholderValues(reset);
  };

  // Detectar placeholders en vivo (por si el operador los agrega al editar body)
  const currentPlaceholders = Array.from(
    new Set([...detectPlaceholders(subject), ...detectPlaceholders(body)])
  );

  const finalSubject = substitute(subject, placeholderValues);
  const finalBody = substitute(body, placeholderValues);

  const handleSend = async () => {
    if (!to.trim() || !finalSubject.trim() || !finalBody.trim()) {
      setSendResult({ ok: false, error: 'Faltan destinatario, asunto o cuerpo.' });
      return;
    }
    setSending(true);
    setSendResult(null);
    try {
      const r = await fetch(`${apiBaseUrl()}/api/admin/ops/send-notification`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: to.trim(),
          subject: finalSubject,
          bodyText: finalBody,
        }),
      });
      const data = await r.json();
      if (r.ok && data.sent) {
        setSendResult({ ok: true, id: data.id });
        // Recarga el log
        loadLog();
      } else {
        setSendResult({ ok: false, error: data.error || `HTTP ${r.status}` });
      }
    } catch (e) {
      setSendResult({ ok: false, error: e.message });
    } finally {
      setSending(false);
    }
  };

  if (loading) return <div style={{ padding: 24 }}>Cargando…</div>;

  return (
    <div style={{ padding: 24, maxWidth: 1100, margin: '0 auto' }}>
      <button
        type="button"
        onClick={onBack}
        style={{
          background: 'none',
          border: 'none',
          color: '#1e3a8a',
          cursor: 'pointer',
          fontSize: 13,
          padding: 0,
          marginBottom: 12,
        }}
      >
        ← Volver al dashboard
      </button>
      <h1 style={{ marginTop: 0, fontSize: 24 }}>📨 Notificaciones</h1>
      <p style={{ color: '#6b7280', fontSize: 14, marginBottom: 24 }}>
        Envía emails ad-hoc a sellers o users. Usa una plantilla para flujos frecuentes o parte
        de cero para mensajes puntuales. Los envíos quedan registrados abajo.
      </p>

      {/* Form de envío */}
      <section
        style={{
          background: '#fff',
          border: '1px solid #e5e7eb',
          borderRadius: 8,
          padding: 20,
          marginBottom: 24,
        }}
      >
        <h2 style={{ fontSize: 16, marginTop: 0, marginBottom: 16 }}>Enviar nuevo</h2>

        <label style={{ display: 'block', marginBottom: 12 }}>
          <span style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>
            Plantilla
          </span>
          <select
            value={selectedTplId}
            onChange={e => applyTemplate(e.target.value)}
            style={{ width: '100%', padding: 8, borderRadius: 6, border: '1px solid #d1d5db' }}
          >
            {templates.map(t => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
          {templates.find(t => t.id === selectedTplId)?.description ? (
            <span style={{ fontSize: 12, color: '#6b7280', display: 'block', marginTop: 4 }}>
              {templates.find(t => t.id === selectedTplId).description}
            </span>
          ) : null}
        </label>

        {/* XOLOLO 2026-11-18 — autocomplete user. Al elegir, se
            pre-llenan `to` y `{{name}}`, y aparece dropdown con
            sus listings para pre-llenar {{listingTitle/Url/expectedVariants}}. */}
        <label style={{ display: 'block', marginBottom: 12, position: 'relative' }}>
          <span style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>
            Para (busca por email o nombre, o pega email directo)
          </span>
          <input
            type="text"
            value={userQuery}
            onChange={e => {
              setUserQuery(e.target.value);
              setTo(e.target.value);
              setShowSuggestions(true);
              if (selectedUser && e.target.value !== (selectedUser.email || selectedUser.displayName)) {
                setSelectedUser(null);
                setUserListings([]);
                setSelectedListingId('');
              }
            }}
            onFocus={() => setShowSuggestions(true)}
            onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
            placeholder="ej. bygastelum, byg@hotmail.com, kike pruebas…"
            style={{ width: '100%', padding: 8, borderRadius: 6, border: '1px solid #d1d5db' }}
            autoComplete="off"
          />
          {showSuggestions && userQuery.length >= 2 && (userSuggestions.length > 0 || searchingUsers) ? (
            <div
              style={{
                position: 'absolute',
                top: '100%',
                left: 0,
                right: 0,
                background: '#fff',
                border: '1px solid #d1d5db',
                borderRadius: 6,
                marginTop: 2,
                maxHeight: 240,
                overflowY: 'auto',
                zIndex: 10,
                boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
              }}
            >
              {searchingUsers ? (
                <div style={{ padding: 10, fontSize: 12, color: '#6b7280' }}>Buscando…</div>
              ) : (
                userSuggestions.map(u => (
                  <button
                    key={u.id}
                    type="button"
                    onMouseDown={e => e.preventDefault()}
                    onClick={() => handleSelectUser(u)}
                    style={{
                      display: 'block',
                      width: '100%',
                      textAlign: 'left',
                      padding: '8px 12px',
                      background: 'none',
                      border: 'none',
                      borderBottom: '1px solid #f3f4f6',
                      cursor: 'pointer',
                      fontSize: 13,
                    }}
                  >
                    <div style={{ fontWeight: 600 }}>{u.displayName || '(sin nombre)'}</div>
                    <div style={{ color: '#6b7280', fontSize: 12 }}>{u.email}</div>
                  </button>
                ))
              )}
            </div>
          ) : null}
          {selectedUser ? (
            <div style={{ fontSize: 12, color: '#065f46', marginTop: 4 }}>
              ✓ User cargado: <strong>{selectedUser.displayName || selectedUser.email}</strong>
              {' · '}
              <button
                type="button"
                onClick={clearSelectedUser}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#dc2626',
                  cursor: 'pointer',
                  padding: 0,
                  fontSize: 12,
                  textDecoration: 'underline',
                }}
              >
                Limpiar
              </button>
            </div>
          ) : null}
        </label>

        {/* Dropdown de listings del user (si lo elegimos) */}
        {selectedUser ? (
          <label style={{ display: 'block', marginBottom: 12 }}>
            <span style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>
              Anuncio del user (opcional — pre-llena placeholders del listing)
            </span>
            {loadingListings ? (
              <div style={{ fontSize: 12, color: '#6b7280', padding: 8 }}>Cargando listings…</div>
            ) : userListings.length === 0 ? (
              <div style={{ fontSize: 12, color: '#6b7280', padding: 8 }}>
                Este user no tiene listings publicados.
              </div>
            ) : (
              <select
                value={selectedListingId}
                onChange={e => handleSelectListing(e.target.value)}
                style={{ width: '100%', padding: 8, borderRadius: 6, border: '1px solid #d1d5db' }}
              >
                <option value="">— Sin anuncio específico —</option>
                {userListings.map(l => (
                  <option key={l.id} value={l.id}>
                    {l.isVariantMaster ? '🎨 ' : ''}
                    {l.title?.slice(0, 60)}
                    {l.isVariantMaster ? ` · ${l.expectedVariants} variantes` : ''}
                    {l.state === 'closed' ? ' (cerrado)' : ''}
                  </option>
                ))}
              </select>
            )}
          </label>
        ) : null}

        {currentPlaceholders.length > 0 ? (
          <div
            style={{
              background: '#eef2ff',
              padding: 12,
              borderRadius: 6,
              marginBottom: 12,
              border: '1px solid #c7d2fe',
            }}
          >
            <div style={{ fontSize: 12, fontWeight: 600, color: '#1e3a8a', marginBottom: 8 }}>
              Placeholders a llenar
            </div>
            {currentPlaceholders.map(k => {
              const cat = placeholdersCatalog.find(p => p.key === k);
              return (
                <label
                  key={k}
                  style={{ display: 'block', marginBottom: 8 }}
                >
                  <span style={{ fontSize: 11, color: '#374151', display: 'block' }}>
                    <code>{`{{${k}}}`}</code>
                    {cat ? ` · ${cat.label}` : ''}
                  </span>
                  <input
                    value={placeholderValues[k] || ''}
                    onChange={e =>
                      setPlaceholderValues(prev => ({ ...prev, [k]: e.target.value }))
                    }
                    style={{
                      width: '100%',
                      padding: 6,
                      borderRadius: 4,
                      border: '1px solid #d1d5db',
                      fontSize: 13,
                    }}
                  />
                </label>
              );
            })}
          </div>
        ) : null}

        <label style={{ display: 'block', marginBottom: 12 }}>
          <span style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>
            Asunto (preview con placeholders llenos)
          </span>
          <input
            value={subject}
            onChange={e => setSubject(e.target.value)}
            style={{ width: '100%', padding: 8, borderRadius: 6, border: '1px solid #d1d5db' }}
          />
          <span style={{ fontSize: 11, color: '#6b7280' }}>
            Final: <strong>{finalSubject || '(vacío)'}</strong>
          </span>
        </label>

        <label style={{ display: 'block', marginBottom: 12 }}>
          <span style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>
            Mensaje (texto plano)
          </span>
          <textarea
            value={body}
            onChange={e => setBody(e.target.value)}
            rows={14}
            style={{
              width: '100%',
              padding: 8,
              borderRadius: 6,
              border: '1px solid #d1d5db',
              fontFamily: 'inherit',
              fontSize: 13,
            }}
          />
        </label>

        {finalBody && finalBody !== body ? (
          <details style={{ marginBottom: 12 }}>
            <summary style={{ cursor: 'pointer', fontSize: 12, color: '#6b7280' }}>
              Ver mensaje final (con placeholders aplicados)
            </summary>
            <pre
              style={{
                whiteSpace: 'pre-wrap',
                background: '#f9fafb',
                padding: 12,
                borderRadius: 6,
                fontSize: 12,
                marginTop: 8,
              }}
            >
              {finalBody}
            </pre>
          </details>
        ) : null}

        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <button
            type="button"
            onClick={handleSend}
            disabled={sending}
            style={{
              background: '#1e3a8a',
              color: '#fff',
              border: 'none',
              borderRadius: 6,
              padding: '10px 20px',
              fontWeight: 600,
              cursor: sending ? 'wait' : 'pointer',
              opacity: sending ? 0.6 : 1,
            }}
          >
            {sending ? 'Enviando…' : 'Enviar email'}
          </button>
          {sendResult ? (
            <span
              style={{
                fontSize: 13,
                color: sendResult.ok ? '#065f46' : '#991b1b',
              }}
            >
              {sendResult.ok
                ? `✓ Enviado · ${sendResult.id}`
                : `✗ Error: ${sendResult.error}`}
            </span>
          ) : null}
        </div>
      </section>

      {/* Historial */}
      <section
        style={{
          background: '#fff',
          border: '1px solid #e5e7eb',
          borderRadius: 8,
          padding: 20,
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 12,
          }}
        >
          <h2 style={{ fontSize: 16, margin: 0 }}>
            Historial de envíos <span style={{ color: '#6b7280', fontWeight: 400 }}>({log.length})</span>
          </h2>
          <button
            type="button"
            onClick={loadLog}
            style={{
              background: 'none',
              border: '1px solid #d1d5db',
              borderRadius: 6,
              padding: '4px 10px',
              fontSize: 12,
              cursor: 'pointer',
            }}
          >
            Refrescar
          </button>
        </div>
        {log.length === 0 ? (
          <p style={{ color: '#6b7280', fontSize: 13 }}>Sin envíos aún.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#f9fafb' }}>
                  <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid #e5e7eb' }}>Fecha</th>
                  <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid #e5e7eb' }}>Para</th>
                  <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid #e5e7eb' }}>Asunto</th>
                  <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid #e5e7eb' }}>Operador</th>
                  <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid #e5e7eb' }}>Estado</th>
                </tr>
              </thead>
              <tbody>
                {log.map(e => (
                  <tr key={e.id}>
                    <td style={{ padding: 8, borderBottom: '1px solid #f3f4f6', color: '#6b7280' }}>
                      {new Date(e.at).toLocaleString('es-MX')}
                    </td>
                    <td style={{ padding: 8, borderBottom: '1px solid #f3f4f6' }}>{e.to}</td>
                    <td style={{ padding: 8, borderBottom: '1px solid #f3f4f6' }}>{e.subject}</td>
                    <td style={{ padding: 8, borderBottom: '1px solid #f3f4f6', color: '#6b7280' }}>
                      {e.operator}
                    </td>
                    <td
                      style={{
                        padding: 8,
                        borderBottom: '1px solid #f3f4f6',
                        color: e.status === 'sent' ? '#065f46' : '#991b1b',
                        fontWeight: 600,
                      }}
                    >
                      {e.status === 'sent' ? '✓ enviado' : `✗ ${e.error || 'fallo'}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p style={{ color: '#9ca3af', fontSize: 11, marginTop: 12, marginBottom: 0 }}>
              Historial en memoria del server (volátil; se reinicia con cada deploy). Para
              persistencia duradera, migrar a metadata del marketplace.
            </p>
          </div>
        )}
      </section>
    </div>
  );
};

export default NotificationsView;
