import React, { useState } from 'react';

import css from './PromoShareButtons.module.css';

// XOLOLO Promote v1 — Sub-commit 2: Share intents.
//
// Un botón por red social + copiar link. Cada botón abre el composer
// nativo de la red (share intent URL) con el post pre-armado. Sin
// OAuth, sin API keys, sin tokens.
//
// URLs usadas:
//   Facebook:   https://www.facebook.com/sharer/sharer.php?u=...
//   Twitter/X:  https://twitter.com/intent/tweet?text=...&url=...
//   WhatsApp:   https://wa.me/?text=... (móvil abre app, desktop web)
//   Instagram:  no tiene share intent web público → Web Share API si
//               disponible (móvil), o "copiar + abrir IG" desktop.
//   TikTok:     igual que Instagram — no hay share intent web.
//
// Analytics: cada URL incluye ?utm_source={red}&utm_medium=xolo-promo.
// El pipeline de tracking existente (src/util/tracking.js) detecta
// esos utm_source y los persiste en listing.metadata para el
// contador de vistas por fuente que se muestra en el dashboard.
//
// Props:
//   listing: { id, slug, title, imageUrl, priceSubunits, priceCurrency }

const MXN = subunits => {
  const n = Number(subunits) || 0;
  return `$${(n / 100).toLocaleString('es-MX', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} MXN`;
};

const buildAbsoluteListingUrl = (listing, source) => {
  if (typeof window === 'undefined') return '';
  const origin = window.location.origin;
  const slug = listing.slug || 'listing';
  const params = new URLSearchParams({
    utm_source: source,
    utm_medium: 'xolo-promo',
    utm_campaign: 'seller',
  });
  return `${origin}/l/${slug}/${listing.id}?${params.toString()}`;
};

const buildShareText = listing => {
  const price = MXN(listing.priceSubunits);
  return `${listing.title} · ${price}\n\n¡Cómpralo en Xololo!`;
};

// -------- Handlers específicos por red --------

const shareFacebook = listing => {
  const url = buildAbsoluteListingUrl(listing, 'facebook');
  const shareUrl = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`;
  window.open(shareUrl, '_blank', 'noopener,noreferrer,width=600,height=600');
};

const shareTwitter = listing => {
  const url = buildAbsoluteListingUrl(listing, 'twitter');
  const text = buildShareText(listing);
  const shareUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(
    text
  )}&url=${encodeURIComponent(url)}`;
  window.open(shareUrl, '_blank', 'noopener,noreferrer,width=600,height=600');
};

const shareWhatsApp = listing => {
  const url = buildAbsoluteListingUrl(listing, 'whatsapp');
  const text = `${buildShareText(listing)}\n${url}`;
  // wa.me funciona en móvil (abre app) y desktop (abre web.whatsapp).
  const shareUrl = `https://wa.me/?text=${encodeURIComponent(text)}`;
  window.open(shareUrl, '_blank', 'noopener,noreferrer');
};

// Instagram/TikTok no tienen share intent web público. Estrategia:
// móvil → Web Share API (abre el picker del sistema, incluye IG/TT);
// desktop → copiar el mensaje al portapapeles y abrir la home de la red
// en una tab nueva para que el seller pegue.
const isMobileUA = () => {
  if (typeof navigator === 'undefined') return false;
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
};

const shareViaWebOrCopy = async (listing, source, brandUrl) => {
  const url = buildAbsoluteListingUrl(listing, source);
  const text = `${buildShareText(listing)}\n${url}`;
  const isMobile = isMobileUA();
  if (isMobile && navigator.share) {
    try {
      await navigator.share({ title: listing.title, text, url });
      return { ok: true };
    } catch (e) {
      // El usuario canceló el picker — no es error real.
      return { ok: false, cancelled: true };
    }
  }
  // Desktop fallback: copiar al portapapeles + abrir la red.
  try {
    await navigator.clipboard.writeText(text);
    window.open(brandUrl, '_blank', 'noopener,noreferrer');
    return { ok: true, copied: true };
  } catch (e) {
    return { ok: false };
  }
};

const shareInstagram = listing => shareViaWebOrCopy(listing, 'instagram', 'https://www.instagram.com');
const shareTikTok = listing => shareViaWebOrCopy(listing, 'tiktok', 'https://www.tiktok.com');

// -------- Componente --------

const IconButton = ({ label, emoji, onClick, disabled, hint }) => (
  <button
    type="button"
    className={css.btn}
    onClick={onClick}
    disabled={disabled}
    title={hint || label}
    aria-label={label}
  >
    <span aria-hidden className={css.btnEmoji}>
      {emoji}
    </span>
    <span className={css.btnLabel}>{label}</span>
  </button>
);

const PromoShareButtons = ({ listing }) => {
  const [copied, setCopied] = useState(null); // 'link' | 'instagram' | 'tiktok' | null

  const handleCopyLink = async () => {
    const url = buildAbsoluteListingUrl(listing, 'link');
    try {
      await navigator.clipboard.writeText(url);
      setCopied('link');
      setTimeout(() => setCopied(null), 2500);
    } catch (e) {
      /* silent */
    }
  };

  const handleInstagram = async () => {
    const r = await shareInstagram(listing);
    if (r?.copied) {
      setCopied('instagram');
      setTimeout(() => setCopied(null), 3500);
    }
  };

  const handleTikTok = async () => {
    const r = await shareTikTok(listing);
    if (r?.copied) {
      setCopied('tiktok');
      setTimeout(() => setCopied(null), 3500);
    }
  };

  return (
    <div className={css.root}>
      <div className={css.row}>
        <IconButton label="Facebook" emoji="📘" onClick={() => shareFacebook(listing)} />
        <IconButton
          label="Instagram"
          emoji="📸"
          onClick={handleInstagram}
          hint="En móvil abre picker del sistema. En desktop copia el post y abre Instagram."
        />
        <IconButton
          label="TikTok"
          emoji="🎵"
          onClick={handleTikTok}
          hint="En móvil abre picker del sistema. En desktop copia el post y abre TikTok."
        />
        <IconButton label="WhatsApp" emoji="💬" onClick={() => shareWhatsApp(listing)} />
        <IconButton label="X / Twitter" emoji="𝕏" onClick={() => shareTwitter(listing)} />
        <IconButton label="Copiar link" emoji="🔗" onClick={handleCopyLink} />
      </div>
      {copied === 'link' ? (
        <p className={css.feedback}>✓ Link copiado al portapapeles</p>
      ) : null}
      {copied === 'instagram' ? (
        <p className={css.feedback}>
          ✓ Post copiado. Abre Instagram y pega en tu Story o Publicación.
        </p>
      ) : null}
      {copied === 'tiktok' ? (
        <p className={css.feedback}>
          ✓ Post copiado. Abre TikTok y pega al crear tu publicación.
        </p>
      ) : null}
    </div>
  );
};

export default PromoShareButtons;
