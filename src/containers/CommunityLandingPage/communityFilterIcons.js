// XOLOLO 2026-11-21 — Iconos de filtro para las comunidades.
//
// El seed en src/config/communities.js define un `iconId` string
// (porque server+client lo comparten y no puede llevar JSX). Aquí
// mapeamos ese id a un SVG outline estilo Xololo (ver patrón en
// src/config/categories.js) para renderizar dentro del Xololo
// iconRing (ver src/components/CategoryRail/CategoryRail.module.css).

import React from 'react';

const Icon = ({ children, viewBox = '0 0 24 24' }) => (
  <svg
    viewBox={viewBox}
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

const ICONS = {
  // Hoja — plantas ornamentales
  leaf: (
    <Icon>
      <path d="M5 20c2-10 7-15 15-15 0 10-5 15-15 15Z" />
      <path d="M5 20l9-9" />
    </Icon>
  ),
  // Flor — flores de corte
  flower: (
    <Icon>
      <circle cx="12" cy="10" r="2.2" />
      <path d="M12 7.8V5a2.2 2.2 0 1 1 0 0Z" />
      <path d="M14.2 10h2.8a2.2 2.2 0 1 1 0 0Z" />
      <path d="M12 12.2V15a2.2 2.2 0 1 1 0 0Z" />
      <path d="M9.8 10H7a2.2 2.2 0 1 1 0 0Z" />
      <path d="M12 15v6" />
      <path d="M9.5 19.5h5" />
    </Icon>
  ),
  // Tijeras — jardinería
  scissors: (
    <Icon>
      <circle cx="6.5" cy="6.5" r="2.5" />
      <circle cx="6.5" cy="17.5" r="2.5" />
      <path d="M8.3 8.3L20 20" />
      <path d="M8.3 15.7L20 4" />
    </Icon>
  ),
  // Árbol — arboricultura
  tree: (
    <Icon>
      <path d="M12 3c3.5 0 6 2.5 6 5.5 0 .9-.2 1.7-.6 2.5 1.6.3 2.6 1.5 2.6 3 0 1.7-1.4 3-3 3H7c-1.7 0-3-1.3-3-3 0-1.5 1-2.7 2.6-3-.4-.8-.6-1.6-.6-2.5 0-3 2.5-5.5 6-5.5Z" />
      <path d="M12 17v4" />
    </Icon>
  ),
  // Ramo — floristería
  bouquet: (
    <Icon>
      <circle cx="12" cy="7" r="2" />
      <circle cx="8" cy="9.5" r="2" />
      <circle cx="16" cy="9.5" r="2" />
      <path d="M8 11.5L12 20" />
      <path d="M16 11.5L12 20" />
      <path d="M12 9v11" />
      <path d="M8 20h8" />
    </Icon>
  ),
  // Tractor — agricultura
  tractor: (
    <Icon>
      <circle cx="7" cy="17" r="3" />
      <circle cx="17" cy="17.5" r="2.5" />
      <path d="M3 13h5l1.5-5h4L15 13h5" />
      <path d="M10 13v-5" />
    </Icon>
  ),
  // Matraz — insumos agrícolas
  vial: (
    <Icon>
      <path d="M9 3h6" />
      <path d="M10 3v6.5L5.5 18A2 2 0 0 0 7.2 21h9.6a2 2 0 0 0 1.7-3L14 9.5V3" />
      <path d="M7 15h10" />
    </Icon>
  ),
};

export const getCommunityFilterIcon = iconId => ICONS[iconId] || null;

export default ICONS;
