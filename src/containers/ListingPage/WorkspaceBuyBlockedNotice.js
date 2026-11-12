// XOLOLO · E9: aviso visible debajo del OrderPanel cuando el user
// está en modo colaborador y por eso no puede comprar este listing.
// Reemplaza la ausencia silenciosa del botón "Agregar al carrito" por
// una explicación de la causa: el rol de colaborador no tiene la
// función de comprar habilitada.

import React from 'react';
import { FormattedMessage } from 'react-intl';

const rootStyle = {
  marginTop: 12,
  padding: '12px 14px',
  border: '1px solid #fbbf24',
  background: '#fffbeb',
  borderRadius: 8,
  fontSize: 13,
  lineHeight: 1.45,
  color: '#78350f',
};

const titleStyle = {
  display: 'block',
  fontWeight: 600,
  marginBottom: 4,
  fontSize: 14,
};

const WorkspaceBuyBlockedNotice = () => (
  <div role="note" style={rootStyle}>
    <span style={titleStyle}>
      <FormattedMessage id="ListingPage.workspaceBlockTitle" />
    </span>
    <FormattedMessage id="ListingPage.workspaceBlockBody" />
  </div>
);

export default WorkspaceBuyBlockedNotice;
