import React from 'react';
import { useSelector } from 'react-redux';

import { useConfiguration } from '../../context/configurationContext';
import { FormattedMessage } from '../../util/reactIntl';
import { selectStorefrontSlug } from '../../ducks/storefrontSubdomain.duck';

import css from './WhatsAppButton.module.css';

// Floating WhatsApp contact button, shown on every page.
// Renders nothing if no phone number has been configured (see config.whatsapp in configDefault.js).
//
// XOLOLO: en storefronts de sellers (subdominios) NO renderizamos el
// WhatsApp corporativo — cada tienda tiene su propio botón que apunta
// al seller. Dejar los dos confunde al buyer.
const WhatsAppButton = () => {
  const config = useConfiguration();
  const { phoneNumber, defaultMessage } = config?.whatsapp || {};
  const storefrontSlug = useSelector(selectStorefrontSlug);

  if (!phoneNumber || storefrontSlug) {
    return null;
  }

  const href = `https://wa.me/${phoneNumber}?text=${encodeURIComponent(defaultMessage || '')}`;

  return (
    <a
      className={css.root}
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="WhatsApp"
      title="WhatsApp"
    >
      <svg className={css.icon} viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 2C6.48 2 2 6.48 2 12c0 1.85.5 3.58 1.36 5.07L2 22l5.09-1.33A9.94 9.94 0 0 0 12 22c5.52 0 10-4.48 10-10S17.52 2 12 2Zm0 18c-1.6 0-3.1-.44-4.38-1.2l-.31-.19-3 .79.8-2.93-.2-.3A7.9 7.9 0 0 1 4 12c0-4.42 3.58-8 8-8s8 3.58 8 8-3.58 8-8 8Zm4.36-5.96c-.24-.12-1.41-.7-1.63-.78-.22-.08-.38-.12-.54.12-.16.24-.62.78-.76.94-.14.16-.28.18-.52.06-.24-.12-1.01-.37-1.92-1.18-.71-.63-1.19-1.42-1.33-1.66-.14-.24-.01-.37.11-.49.11-.11.24-.28.36-.42.12-.14.16-.24.24-.4.08-.16.04-.3-.02-.42-.06-.12-.54-1.3-.74-1.78-.19-.46-.39-.4-.54-.41h-.46c-.16 0-.42.06-.64.3-.22.24-.84.82-.84 2s.86 2.32.98 2.48c.12.16 1.7 2.6 4.12 3.64.58.25 1.03.4 1.38.51.58.18 1.11.16 1.53.1.47-.07 1.41-.58 1.61-1.14.2-.56.2-1.04.14-1.14-.06-.1-.22-.16-.46-.28Z" />
      </svg>
      <span className={css.label}>
        <FormattedMessage id="WhatsAppButton.label" defaultMessage="WhatsApp" />
      </span>
    </a>
  );
};

export default WhatsAppButton;
