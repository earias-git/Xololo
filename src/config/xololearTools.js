// XOLOLO: herramientas que aparecen en la banda XOLOLEAR del landing.
// Cada tool es una píldora chica con ícono + título + descripción corta.
// Son las 4 herramientas núcleo que Xololo Promote entrega al seller.
//
// Los íconos son componentes React para heredar currentColor del tema de
// la banda (verde Xololo sobre fondo navy) sin re-exportar por tamaño.
//
// Si se agrega una 5ª herramienta, revisar el CSS del grid en
// XololearBand.module.css — hoy está pensado para 4 columnas desktop.

import React from 'react';

const linkPath = (
  <>
    <path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 1 0-5.66-5.66l-1 1" />
    <path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 1 0 5.66 5.66l1-1" />
  </>
);

const qrPath = (
  <>
    <rect x="3" y="3" width="7" height="7" rx="1" />
    <rect x="14" y="3" width="7" height="7" rx="1" />
    <rect x="3" y="14" width="7" height="7" rx="1" />
    <path d="M14 14h3M20 14v3M14 20h3M20 20h1" />
  </>
);

const cartPath = (
  <>
    <path d="M3 4h2l2.5 11a2 2 0 0 0 2 1.6h7.6a2 2 0 0 0 2-1.6L21 7H6" />
    <circle cx="9.5" cy="20" r="1.4" />
    <circle cx="17.5" cy="20" r="1.4" />
  </>
);

const chartPath = (
  <>
    <path d="M4 20V10M10 20V4M16 20v-6M22 20H2" />
  </>
);

const Icon = ({ children }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {children}
  </svg>
);

const xololearTools = [
  {
    id: 'link-profesional',
    title: 'Link profesional',
    description: 'tutienda.xololo.mx — pégalo en tu bio de IG y WhatsApp',
    icon: <Icon>{linkPath}</Icon>,
  },
  {
    id: 'qr-carteles',
    title: 'QR + carteles',
    description: 'Comparte tus productos en Stories y Status',
    icon: <Icon>{qrPath}</Icon>,
  },
  {
    id: 'boton-comprar',
    title: 'Botón Comprar',
    description: 'Convierte sin salir del chat de WhatsApp',
    icon: <Icon>{cartPath}</Icon>,
  },
  {
    id: 'tracking',
    title: 'Tracking por red',
    description: 'Sabes qué red social te trae más ventas',
    icon: <Icon>{chartPath}</Icon>,
  },
];

export default xololearTools;
