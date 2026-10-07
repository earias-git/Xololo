// XOLOLO Fase 1C (hoja Arquitectura técnica §6) — Catálogo de roles
// RBAC para el módulo /admin de operadores Xololo. Decisiones
// cerradas con earias 2026-10-06 (Google Sheets "Políticas de
// Refund" → batch 4, pregunta 3):
//
// 5 roles con permisos default. El super admin puede sobrescribir
// permisos de operators individuales vía operator_permissions_overrides
// (ver §1 del documento de arquitectura).

const ROLES = {
  SUPER_ADMIN: 'super_admin',
  OPERATOR_PENALTIES: 'operator_penalties',
  OPERATOR_LOGISTICS: 'operator_logistics',
  ACCOUNTING: 'accounting',
  READONLY: 'readonly',
};

const ALL_ROLES = Object.values(ROLES);

// Módulos del módulo /admin donde se aplican permisos.
const MODULES = {
  PENALTIES: 'penalties',           // cola de penalidades, aprobar/rechazar/revertir
  DISPUTES: 'disputes',             // cola de disputes + mediación
  APPEALS: 'appeals',               // apelaciones de sellers
  LOGISTICS: 'logistics',           // guías, fletes, entregas
  ACCOUNTING: 'accounting',         // Facturama, Stripe balance, CxC/CxP
  USERS: 'users',                   // ver seller/buyer history, perfiles
  OPERATORS: 'operators',           // CRUD de operadores (super_admin)
  AUDIT_LOG: 'audit_log',           // registro de acciones
  SETTINGS: 'settings',             // configuración global (tasas, timeouts)
};

// Acciones estándar por módulo.
const ACTIONS = {
  VIEW: 'view',           // solo lectura
  CREATE: 'create',       // crear registro nuevo
  UPDATE: 'update',       // modificar registro existente
  APPROVE: 'approve',     // aprobar penalidad propuesta por sistema
  REVERT: 'revert',       // revertir decisión previa
  EXPORT: 'export',       // descargar CSV / reporte
  SUSPEND: 'suspend',     // suspender un operator (SUPER_ADMIN)
};

// Matriz default de permisos. Lee: PERMISSIONS[rol][modulo] = Set<acciones>
// Super admin puede sobrescribir con operator_permissions_overrides.
const PERMISSIONS = {
  [ROLES.SUPER_ADMIN]: {
    // Super admin ve y hace TODO en todos los módulos.
    [MODULES.PENALTIES]: ['view', 'create', 'update', 'approve', 'revert', 'export'],
    [MODULES.DISPUTES]: ['view', 'create', 'update', 'approve', 'revert', 'export'],
    [MODULES.APPEALS]: ['view', 'approve', 'revert', 'export'],
    [MODULES.LOGISTICS]: ['view', 'update', 'export'],
    [MODULES.ACCOUNTING]: ['view', 'update', 'export'],
    [MODULES.USERS]: ['view', 'update', 'export'],
    [MODULES.OPERATORS]: ['view', 'create', 'update', 'suspend', 'export'],
    [MODULES.AUDIT_LOG]: ['view', 'export'],
    [MODULES.SETTINGS]: ['view', 'update'],
  },
  [ROLES.OPERATOR_PENALTIES]: {
    [MODULES.PENALTIES]: ['view', 'create', 'update', 'approve', 'revert'],
    [MODULES.DISPUTES]: ['view', 'approve', 'revert'],
    [MODULES.APPEALS]: ['view', 'approve', 'revert'],
    [MODULES.USERS]: ['view'],
    [MODULES.AUDIT_LOG]: ['view'],
    // Sin acceso a logistics, accounting, operators ni settings.
  },
  [ROLES.OPERATOR_LOGISTICS]: {
    [MODULES.LOGISTICS]: ['view', 'update'],
    [MODULES.USERS]: ['view'],
    [MODULES.DISPUTES]: ['view'], // puede ver disputes relacionadas con logística
    [MODULES.AUDIT_LOG]: ['view'],
    // Sin penalidades (approve/revert), sin accounting.
  },
  [ROLES.ACCOUNTING]: {
    [MODULES.ACCOUNTING]: ['view', 'update', 'export'],
    [MODULES.PENALTIES]: ['view', 'export'],   // ve cargos para contabilizar
    [MODULES.DISPUTES]: ['view', 'export'],
    [MODULES.USERS]: ['view'],                 // ver RFC + Constancia SAT
    [MODULES.AUDIT_LOG]: ['view', 'export'],
    // Sin approve/revert — contabilidad reporta, no decide.
  },
  [ROLES.READONLY]: {
    [MODULES.PENALTIES]: ['view'],
    [MODULES.DISPUTES]: ['view'],
    [MODULES.APPEALS]: ['view'],
    [MODULES.LOGISTICS]: ['view'],
    [MODULES.ACCOUNTING]: ['view'],
    [MODULES.USERS]: ['view'],
    [MODULES.AUDIT_LOG]: ['view'],
    // Puro lector. Útil para auditor externo o abogado.
  },
};

const isValidRole = role => ALL_ROLES.includes(role);

/**
 * Verifica si un rol tiene permiso para hacer una acción en un módulo.
 * Considera overrides por operator (si se pasan).
 *
 * @param {string} role — uno de ROLES.
 * @param {string} module — uno de MODULES.
 * @param {string} action — una de ACTIONS.
 * @param {Array<{module, action, allowed}>?} overrides — opcional, filas
 *   de operator_permissions_overrides para este operator en particular.
 * @returns {boolean}
 */
const hasPermission = (role, module, action, overrides = []) => {
  // Checar override explícito primero (allowed=false bloquea aunque el
  // rol tenga permiso; allowed=true otorga aunque el rol no lo tenga).
  const override = overrides.find(o => o.module === module && o.action === action);
  if (override) return !!override.allowed;

  const roleMatrix = PERMISSIONS[role];
  if (!roleMatrix) return false;
  const moduleActions = roleMatrix[module];
  if (!moduleActions) return false;
  return moduleActions.includes(action);
};

/**
 * Devuelve lista de módulos a los que el rol tiene al menos permiso 'view'.
 * Usado para construir el menú del /admin.
 */
const visibleModules = (role, overrides = []) => {
  return Object.values(MODULES).filter(module => hasPermission(role, module, ACTIONS.VIEW, overrides));
};

/**
 * Label legible para la UI (Spanish).
 */
const ROLE_LABELS = {
  [ROLES.SUPER_ADMIN]: 'Super Admin (CEO)',
  [ROLES.OPERATOR_PENALTIES]: 'Operador de Penalidades',
  [ROLES.OPERATOR_LOGISTICS]: 'Operador de Logística',
  [ROLES.ACCOUNTING]: 'Contabilidad',
  [ROLES.READONLY]: 'Solo Lectura',
};

module.exports = {
  ROLES,
  ALL_ROLES,
  MODULES,
  ACTIONS,
  PERMISSIONS,
  ROLE_LABELS,
  isValidRole,
  hasPermission,
  visibleModules,
};
