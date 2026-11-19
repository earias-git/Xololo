/**
 * XOLOLO 2026-11-18 — ADR-006 PR-8: chips de comunidades del seller.
 *
 * Componente reutilizable. Dado un profile (o publicData.communities
 * directo), muestra chips linkables a la landing de cada comunidad.
 *
 * Diseño:
 * - Source of truth del catálogo = src/config/communities.js (misma
 *   que el backend). Lookup client-side sin fetch adicional.
 * - Solo muestra comunidades publicadas (isPublished=true). Las
 *   despublicadas o eliminadas se filtran silenciosamente.
 * - Si no hay membresías, no renderiza nada (null).
 *
 * Props:
 *   - profile: objeto seller.attributes.profile (desde SDK), o
 *   - communities: el objeto crudo publicData.communities (atajo).
 *   - layout: 'inline' | 'stack' (default 'inline').
 *   - size: 'sm' | 'md' (default 'md').
 *   - theme: 'light' | 'dark' (default 'light'). 'dark' para hero.
 *   - prefix: texto antes de los chips (default 'Vive en:').
 */

import React from 'react';

import { COMMUNITIES_SEED } from '../../config/communities';
import {
  COMMUNITY_TYPES,
  getCommunityRoute,
  isValidCommunityId,
} from '../../util/communities';

import css from './CommunityBadges.module.css';

// Index interno en-memoria. COMMUNITIES_SEED es un array estático
// bundled al deploy, así que compilarlo una vez es barato.
let _byId = null;
const indexBySlug = () => {
  if (_byId) return _byId;
  _byId = new Map();
  for (const c of COMMUNITIES_SEED) {
    if (!c?.isPublished || c?.isDeleted) continue;
    _byId.set(c.id, c);
  }
  return _byId;
};

const initialsOf = name => {
  if (!name) return 'C';
  const parts = String(name).split(/[^a-zA-Z0-9]+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + (parts[1][0] || '')).toUpperCase();
};

const extractCommunities = ({ profile, communities }) => {
  const source = communities || profile?.publicData?.communities;
  if (!source || typeof source !== 'object') return [];
  const idx = indexBySlug();
  const out = [];
  for (const type of COMMUNITY_TYPES) {
    const arr = Array.isArray(source[type]) ? source[type] : [];
    for (const id of arr) {
      if (!isValidCommunityId(id)) continue;
      const community = idx.get(id);
      // Silencia comunidades no publicadas o eliminadas del catálogo
      // (consistencia con /api/communities que tampoco las devuelve).
      if (!community) continue;
      if (community.type !== type) continue; // sanity: id en array equivocado
      out.push(community);
    }
  }
  return out;
};

const CommunityBadge = ({ community, size, theme }) => {
  const href = getCommunityRoute(community) || '#';
  const bg = community.branding?.primaryColor || '#2d5016';
  const chipClass = [
    css.chip,
    size === 'sm' ? css.chipSm : null,
    theme === 'dark' ? css.chipDark : null,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <a
      className={chipClass}
      href={href}
      aria-label={`Ver comunidad ${community.name}`}
      title={community.tagline || community.name}
    >
      {community.branding?.logoUrl ? (
        <img
          className={css.logo}
          src={community.branding.logoUrl}
          alt=""
          aria-hidden="true"
        />
      ) : (
        <span className={css.logoPlaceholder} style={{ background: bg }} aria-hidden="true">
          {initialsOf(community.name)}
        </span>
      )}
      <span className={css.name}>{community.name}</span>
    </a>
  );
};

const CommunityBadges = ({
  profile,
  communities,
  layout = 'inline',
  size = 'md',
  theme = 'light',
  prefix = 'Vive en:',
  className,
}) => {
  const items = extractCommunities({ profile, communities });
  if (items.length === 0) return null;

  const rootClass = [
    css.root,
    layout === 'stack' ? css.rootStack : css.rootInline,
    theme === 'dark' ? css.rootDark : null,
    className || null,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={rootClass}>
      {prefix ? <span className={css.prefix}>{prefix}</span> : null}
      <div className={css.chipsRow}>
        {items.map(c => (
          <CommunityBadge key={`${c.type}:${c.id}`} community={c} size={size} theme={theme} />
        ))}
      </div>
    </div>
  );
};

export default CommunityBadges;
