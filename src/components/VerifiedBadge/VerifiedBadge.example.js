import VerifiedBadge from './VerifiedBadge';

// XOLOLO 2026-11-23: ejemplos del badge Xololo Verified.
// Visibles en /styleguide/c/VerifiedBadge.

export const SizeMd = {
  component: VerifiedBadge,
  props: { verified: true, size: 'md' },
  group: 'xololo',
};

export const SizeSm = {
  component: VerifiedBadge,
  props: { verified: true, size: 'sm' },
  group: 'xololo',
};

export const SizeLg = {
  component: VerifiedBadge,
  props: { verified: true, size: 'lg' },
  group: 'xololo',
};

export const NoLabel = {
  component: VerifiedBadge,
  props: { verified: true, size: 'md', showLabel: false },
  group: 'xololo',
};

// Cuando el flag es false, el badge devuelve null — no ocupa espacio.
export const NotVerified = {
  component: VerifiedBadge,
  props: { verified: false, size: 'md' },
  group: 'xololo',
};
