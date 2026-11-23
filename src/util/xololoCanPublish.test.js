import { canPublishListings, isPublishAllowed } from './xololoCanPublish';

const mkUser = (sellerMode = 'store') => ({
  id: { uuid: 'u-1' },
  attributes: { profile: { publicData: { sellerMode } } },
});

describe('canPublishListings', () => {
  it('bloquea cuando no hay user', () => {
    const r = canPublishListings(null, { status: 'active' });
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe('no_plan');
  });

  it('exime a casual_reseller aunque no tenga suscripción', () => {
    const r = canPublishListings(mkUser('casual_reseller'), null);
    expect(r.allowed).toBe(true);
    expect(r.reason).toBe('casual_exempt');
  });

  it('exime a casual_reseller aunque su suscripción esté canceled', () => {
    const r = canPublishListings(mkUser('casual_reseller'), { status: 'canceled' });
    expect(r.allowed).toBe(true);
  });

  it('bloquea store sin suscripción (status none)', () => {
    const r = canPublishListings(mkUser('store'), { status: 'none' });
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe('no_plan');
  });

  it('bloquea store cuando subscription es null/undefined', () => {
    expect(canPublishListings(mkUser('store'), null).allowed).toBe(false);
    expect(canPublishListings(mkUser('store'), undefined).allowed).toBe(false);
  });

  it('bloquea store con status canceled (plan terminado)', () => {
    const r = canPublishListings(mkUser('store'), { status: 'canceled' });
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe('canceled');
  });

  it('permite store con status active', () => {
    const r = canPublishListings(mkUser('store'), { status: 'active' });
    expect(r.allowed).toBe(true);
    expect(r.reason).toBe('active');
  });

  it('permite store con status trialing', () => {
    const r = canPublishListings(mkUser('store'), { status: 'trialing' });
    expect(r.allowed).toBe(true);
    expect(r.reason).toBe('trialing');
  });

  it('permite store con status past_due (ventana de gracia)', () => {
    const r = canPublishListings(mkUser('store'), { status: 'past_due' });
    expect(r.allowed).toBe(true);
    expect(r.reason).toBe('past_due');
  });

  it('bloquea defensivamente con status desconocido', () => {
    const r = canPublishListings(mkUser('store'), { status: 'incomplete_expired' });
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe('unknown');
  });

  it('default sellerMode=store cuando no está declarado', () => {
    const user = { id: { uuid: 'u-1' }, attributes: { profile: { publicData: {} } } };
    expect(canPublishListings(user, { status: 'active' }).allowed).toBe(true);
    expect(canPublishListings(user, null).allowed).toBe(false);
  });

  it('isPublishAllowed devuelve booleano directo', () => {
    expect(isPublishAllowed(mkUser('store'), { status: 'active' })).toBe(true);
    expect(isPublishAllowed(mkUser('store'), null)).toBe(false);
    expect(isPublishAllowed(mkUser('casual_reseller'), null)).toBe(true);
  });
});
