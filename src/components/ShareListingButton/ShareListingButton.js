import React, { useState, useRef, useEffect } from 'react';
import classNames from 'classnames';

import { trackEvent } from '../../util/tracking';

import css from './ShareListingButton.module.css';

// XOLOLO F3 Sprint 2B: botón "Compartir" en ListingPage. Menu con:
//   WhatsApp / Facebook / Instagram / Twitter / Copiar link
//
// Cada click dispara listing.shared_external con el channel elegido —
// da atribución PRECISA (no depende del referrer del browser cuando
// alguien entre desde ese link). El link compartido incluye UTMs para
// identificar la fuente cuando el destinatario lo abra.
//
// Instagram no tiene URL scheme para pre-populate — sólo copiamos el
// link con instrucción. Twitter/X sí, pero es marginal en MX; lo
// mantenemos para completitud.
//
// Props:
//   listingId (uuid string, requerido)
//   listingTitle (string, opcional, para el mensaje pre-populado)
//   listingUrl (string, opcional, URL absoluta al listing — si falta,
//     usa window.location.href)

const CHANNELS = [
  {
    key: 'whatsapp',
    label: 'WhatsApp',
    icon: 'ti-brand-whatsapp',
    color: '#25D366',
    buildUrl: ({ title, url }) => {
      const text = title ? `${title} — ${url}` : url;
      return `https://wa.me/?text=${encodeURIComponent(text)}`;
    },
  },
  {
    key: 'facebook',
    label: 'Facebook',
    icon: 'ti-brand-facebook',
    color: '#1877F2',
    buildUrl: ({ url }) => `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`,
  },
  {
    key: 'twitter',
    label: 'X (Twitter)',
    icon: 'ti-brand-x',
    color: '#000000',
    buildUrl: ({ title, url }) => {
      const text = title ? `${title}` : '';
      return `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
    },
  },
  {
    key: 'instagram',
    label: 'Instagram',
    icon: 'ti-brand-instagram',
    color: '#E4405F',
    // Instagram no tiene share intent web — se copia el link.
    buildUrl: null,
  },
  {
    key: 'copy_link',
    label: 'Copiar link',
    icon: 'ti-link',
    color: '#5F5E5A',
    buildUrl: null,
  },
];

// Añade UTMs al URL para tracking preciso cuando alguien entre desde
// el link compartido. Ver src/util/tracking.js detectSource → prioriza
// utm_source sobre referrer.
const withUtms = (rawUrl, channel) => {
  try {
    const url = new URL(rawUrl);
    url.searchParams.set('utm_source', channel);
    url.searchParams.set('utm_medium', 'share');
    return url.toString();
  } catch (e) {
    return rawUrl;
  }
};

const ShareListingButton = ({
  listingId,
  listingTitle,
  listingUrl,
  className,
  rootClassName,
}) => {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const handler = e => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const handleChannel = channel => {
    const url =
      listingUrl || (typeof window !== 'undefined' ? window.location.href : '');
    const shareUrl = withUtms(url, channel.key);

    // Track antes de abrir la ventana externa — así no perdemos el
    // evento si el user navega afuera antes de que el fetch complete.
    trackEvent(
      'listing.shared_external',
      { listingId, channel: channel.key },
      { dedupe: false } // cada share cuenta
    );

    if (channel.key === 'copy_link' || channel.key === 'instagram') {
      // Instagram no tiene share URL — copia link con instrucción.
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        navigator.clipboard.writeText(shareUrl).then(
          () => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2200);
          },
          () => {
            // fallback silente
          }
        );
      }
      if (channel.key === 'instagram') {
        setCopied(true);
        setTimeout(() => setCopied(false), 2200);
      }
      return;
    }
    if (channel.buildUrl) {
      const targetUrl = channel.buildUrl({ title: listingTitle, url: shareUrl });
      window.open(targetUrl, '_blank', 'noopener,noreferrer');
    }
    setOpen(false);
  };

  return (
    <div className={classNames(rootClassName || css.root, className)} ref={menuRef}>
      <button
        type="button"
        className={css.trigger}
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <i className="ti ti-share" aria-hidden />
        Compartir
      </button>
      {open ? (
        <div className={css.menu} role="menu">
          {CHANNELS.map(c => (
            <button
              key={c.key}
              type="button"
              role="menuitem"
              className={css.menuItem}
              onClick={() => handleChannel(c)}
            >
              <span
                className={css.menuIcon}
                aria-hidden
                style={{ color: c.color }}
              >
                <i className={`ti ${c.icon}`} />
              </span>
              {c.label}
              {c.key === 'instagram' ? (
                <span className={css.menuHint}>copia link</span>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
      {copied ? <span className={css.toast}>Link copiado ✓</span> : null}
    </div>
  );
};

export default ShareListingButton;
