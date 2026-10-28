// XOLOLO Tier Empresarial · E2 — tests del token de invitación.

const jwt = require('jsonwebtoken');
const { signInviteToken, verifyInviteToken, TTL_SECONDS } = require('./teamInviteToken');

describe('signInviteToken', () => {
  it('firma un JWT válido con los claims', () => {
    const token = signInviteToken({
      adminId: 'admin-1',
      adminEmail: 'admin@x.mx',
      collaboratorEmail: '  COLLAB@x.mx  ',
      roleName: 'logistics',
      permissions: ['shipping', 'orders.view'],
    });
    expect(typeof token).toBe('string');
    const decoded = jwt.decode(token);
    expect(decoded.sub).toBe('collab@x.mx'); // normalizado lowercase + trim
    expect(decoded.adminId).toBe('admin-1');
    expect(decoded.adminEmail).toBe('admin@x.mx');
    expect(decoded.kind).toBe('team_invite');
    expect(decoded.permissions).toEqual(['shipping', 'orders.view']);
  });

  it('rechaza argumentos faltantes', () => {
    expect(() => signInviteToken({ collaboratorEmail: 'x', roleName: 'r' })).toThrow('adminId_required');
    expect(() => signInviteToken({ adminId: 'a', roleName: 'r' })).toThrow('collaboratorEmail_required');
    expect(() => signInviteToken({ adminId: 'a', collaboratorEmail: 'x' })).toThrow('roleName_required');
  });

  it('TTL es 7 días', () => {
    const token = signInviteToken({
      adminId: 'a',
      collaboratorEmail: 'c@x.mx',
      roleName: 'r',
      permissions: [],
    });
    const { exp, iat } = jwt.decode(token);
    expect(exp - iat).toBe(TTL_SECONDS);
    expect(TTL_SECONDS).toBe(7 * 24 * 60 * 60);
  });
});

describe('verifyInviteToken', () => {
  it('token válido → payload', () => {
    const token = signInviteToken({
      adminId: 'admin-1',
      collaboratorEmail: 'c@x.mx',
      roleName: 'manager',
      permissions: ['listings.create'],
    });
    const r = verifyInviteToken(token);
    expect(r.ok).toBe(true);
    expect(r.payload.adminId).toBe('admin-1');
  });

  it('token nulo o vacío → invalid_shape', () => {
    expect(verifyInviteToken(null)).toEqual({ error: 'invalid_shape' });
    expect(verifyInviteToken('')).toEqual({ error: 'invalid_shape' });
  });

  it('token con firma distinta → invalid_signature', () => {
    const bad = jwt.sign({ kind: 'team_invite', sub: 'x', adminId: 'y', roleName: 'z' }, 'otro-secret');
    const r = verifyInviteToken(bad);
    expect(r.error).toBe('invalid_signature');
  });

  it('token sin kind team_invite → invalid_shape', () => {
    // Lo firmamos con el mismo secret pero con otro kind.
    const secret = process.env.TEAM_INVITE_SECRET || process.env.JWT_SECRET || process.env.OPERATOR_SESSION_SECRET || 'xololo-dev-only-team-invite';
    const t = jwt.sign({ kind: 'other', sub: 'x', adminId: 'y', roleName: 'z' }, secret);
    expect(verifyInviteToken(t)).toEqual({ error: 'invalid_shape' });
  });

  it('token expirado → expired', () => {
    const secret = process.env.TEAM_INVITE_SECRET || process.env.JWT_SECRET || process.env.OPERATOR_SESSION_SECRET || 'xololo-dev-only-team-invite';
    const t = jwt.sign(
      { kind: 'team_invite', sub: 'x', adminId: 'y', roleName: 'z', permissions: [] },
      secret,
      { expiresIn: -10 }
    );
    expect(verifyInviteToken(t)).toEqual({ error: 'expired' });
  });

  it('rotación: acepta token firmado con TEAM_INVITE_SECRET_PREV', () => {
    const prev = 'prev-secret-abc';
    const current = 'current-secret-xyz';
    const originalEnv = { ...process.env };
    process.env.TEAM_INVITE_SECRET = current;
    process.env.TEAM_INVITE_SECRET_PREV = prev;
    try {
      // Firmamos con el previo
      const t = jwt.sign(
        { kind: 'team_invite', sub: 'x', adminId: 'y', roleName: 'z', permissions: [] },
        prev
      );
      const r = verifyInviteToken(t);
      expect(r.ok).toBe(true);
    } finally {
      process.env.TEAM_INVITE_SECRET = originalEnv.TEAM_INVITE_SECRET;
      process.env.TEAM_INVITE_SECRET_PREV = originalEnv.TEAM_INVITE_SECRET_PREV;
    }
  });
});
