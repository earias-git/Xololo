import React from 'react';

// XOLOLO: las 7 categorías del landing (paridad con la sección "Categorias"
// del asset hospedado). Los `href` apuntan al SearchPage filtrando por la
// categoría correspondiente; ajustar la key (`pub_categoryLevel1`) si el
// listing schema del Console usa otra.

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

const categories = [
  {
    id: 'artesanias',
    label: 'Artesanías',
    href: '/s?pub_categoryLevel1=artesanias',
    icon: (
      <Icon>
        <path d="M6 8h12l-1 12H7L6 8Z" />
        <path d="M9 8V6a3 3 0 0 1 6 0v2" />
      </Icon>
    ),
  },
  {
    id: 'moda',
    label: 'Moda',
    href: '/s?pub_categoryLevel1=moda',
    icon: (
      <Icon>
        <path d="M8 3l-2 3v14h12V6l-2-3" />
        <path d="M8 3h8" />
      </Icon>
    ),
  },
  {
    id: 'belleza',
    label: 'Belleza',
    href: '/s?pub_categoryLevel1=belleza',
    icon: (
      <Icon>
        <path d="M12 21s-7-4.6-9.3-9A5.3 5.3 0 0 1 12 6a5.3 5.3 0 0 1 9.3 6c-2.3 4.4-9.3 9-9.3 9Z" />
      </Icon>
    ),
  },
  {
    id: 'turismo',
    label: 'Turismo',
    href: '/s?pub_categoryLevel1=turismo',
    icon: (
      <Icon>
        <path d="M2 12h20" />
        <path d="M5 12a7 5 0 0 0 14 0" />
        <path d="M9 12V7a3 3 0 0 1 6 0v5" />
      </Icon>
    ),
  },
  {
    id: 'wellness',
    label: 'Wellness',
    href: '/s?pub_categoryLevel1=wellness',
    icon: (
      <Icon>
        <circle cx="12" cy="5" r="1.6" />
        <path d="M8 20l2.5-7L8 10l2-4 2 3h2l2-3 2 4-2.5 3L18 20" />
      </Icon>
    ),
  },
  {
    id: 'consultoria',
    label: 'Consultoría',
    href: '/s?pub_categoryLevel1=consultoria',
    icon: (
      <Icon>
        <path d="M9 3h6l1 4H8l1-4Z" />
        <path d="M5 8h14l-1 13H6L5 8Z" />
      </Icon>
    ),
  },
  {
    id: 'agro-alimentos',
    label: 'Agro y Alimentos',
    href: '/s?pub_categoryLevel1=agro-alimentos',
    icon: (
      <Icon>
        <path d="M4 10h16" />
        <path d="M6 10V6h12v4" />
        <path d="M5 10l1 10h12l1-10" />
      </Icon>
    ),
  },
];

export default categories;
