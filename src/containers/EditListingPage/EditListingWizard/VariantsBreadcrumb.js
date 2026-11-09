import React, { useEffect, useState } from 'react';

import { useConfiguration } from '../../../context/configurationContext';
import { useRouteConfiguration } from '../../../context/routeConfigurationContext';
import { createResourceLocatorString } from '../../../util/routes';
import { LISTING_PAGE_PARAM_TYPE_EDIT } from '../../../util/urlHelpers';
import {
  getVariantGroupId,
  getVariantValues,
  isVariantMaster,
  variantLabel,
  getVariantAxes,
} from '../../../util/variants';

import { NamedLink } from '../../../components';

import css from './VariantsBreadcrumb.module.css';

// XOLOLO (variantes · PR 5) — Breadcrumb en el wizard cuando el listing
// pertenece a un grupo de variantes.
//
// Para el master: muestra "Editando grupo" + info de que los cambios en
// campos compartidos (foto/título/descripción) se replican a todos los
// hermanos.
//
// Para un child: muestra link al master ("Editar grupo completo") +
// quick-nav a los hermanos del grupo.
//
// El fetch de hermanos es ligero: query SDK por pub_variantGroupId.
// Si falla (falta el campo, offline), el componente simplemente no se
// pinta — nunca bloquea el wizard.

const buildEditUrl = (routeConfiguration, listing) => {
  const id = listing?.id?.uuid;
  if (!id) return null;
  const title = listing.attributes?.title || 'listing';
  const slug = title
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'listing';
  return createResourceLocatorString(
    'EditListingPage',
    routeConfiguration,
    { id, slug, type: LISTING_PAGE_PARAM_TYPE_EDIT, tab: 'pricing-and-stock' },
    {}
  );
};

const VariantsBreadcrumb = props => {
  const { listing } = props;
  const routeConfiguration = useRouteConfiguration();
  // SDK no está en props aquí; usamos fetch via Redux Toolkit no — es
  // un "nice to have" leve. Preferimos cero dependencias: hacemos el
  // fetch directo con sdk del window si existe, o cae a 'sin links'.
  //
  // Simplificación: pedimos los hermanos con un pequeño fetch al mismo
  // endpoint ownListings (via window.sdkTypes no es accesible). Para
  // mantener el componente puramente presentacional, aceptamos siblings
  // como prop opcional; si no vienen, mostramos solo el breadcrumb
  // textual sin quick-nav.
  const siblings = props.siblings || [];

  if (!listing || !getVariantGroupId(listing)) return null;

  const axes = getVariantAxes(listing);
  const isMaster = isVariantMaster(listing);
  const label = variantLabel(getVariantValues(listing), axes);
  const master = isMaster
    ? listing
    : siblings.find(s => isVariantMaster(s)) || null;

  // Hermanos distintos al listing actual, master primero.
  const quickNav = [];
  if (master && master.id?.uuid !== listing.id?.uuid) {
    quickNav.push({ listing: master, isMaster: true });
  }
  for (const s of siblings) {
    if (s.id?.uuid === listing.id?.uuid) continue;
    if (master && s.id?.uuid === master.id?.uuid) continue;
    quickNav.push({ listing: s, isMaster: false });
  }

  return (
    <div className={css.root} role="note">
      <div className={css.info}>
        <span className={css.label}>
          {isMaster ? 'Editando grupo de variantes' : 'Editando una variante'}
        </span>
        <span className={css.title}>
          {master?.attributes?.title || listing.attributes?.title || 'Grupo'}
          {label ? ` · ${label}` : null}
        </span>
        {isMaster ? (
          <p className={css.masterNote}>
            Los cambios en fotos, título y descripción se replican a todas las variantes del
            grupo al guardar. Stock y precio por variante se ajustan en la pestaña Variantes.
          </p>
        ) : (
          <p className={css.masterNote}>
            Stock y precio son propios de esta variante. Para editar fotos, título o
            descripción comunes al grupo, abre el master.
          </p>
        )}
      </div>

      {quickNav.length > 0 ? (
        <div className={css.links}>
          {quickNav.map(({ listing: sib, isMaster: sibIsMaster }) => {
            const href = buildEditUrl(routeConfiguration, sib);
            const sibLabel = sibIsMaster
              ? 'Master'
              : variantLabel(getVariantValues(sib), axes) || sib.attributes?.title || '…';
            return (
              <a
                key={sib.id.uuid}
                href={href || '#'}
                className={css.link}
                title={sib.attributes?.title}
              >
                {sibLabel}
              </a>
            );
          })}
        </div>
      ) : null}
    </div>
  );
};

export default VariantsBreadcrumb;
