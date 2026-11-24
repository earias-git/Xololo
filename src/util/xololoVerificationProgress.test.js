import { getVerificationProgress, verificationStatusLabel } from './xololoVerificationProgress';

// XOLOLO PR 2 (Verified): blindaje del cálculo de progreso.

const SLOTS = [
  { key: 'a' },
  { key: 'b' },
  { key: 'c' },
  { key: 'd' },
];

describe('getVerificationProgress', () => {
  it('returns zeros when nothing uploaded', () => {
    const p = getVerificationProgress({ slots: SLOTS, docs: {} });
    expect(p).toEqual({
      total: 4,
      approved: 0,
      inReview: 0,
      rejected: 0,
      uploaded: 0,
      allApproved: false,
      hasRejected: false,
      pct: 0,
    });
  });

  it('counts approved, pending (treated as inReview) and rejected', () => {
    const p = getVerificationProgress({
      slots: SLOTS,
      docs: {
        a: { status: 'approved' },
        b: { status: 'pending' },
        c: { status: 'rejected' },
      },
    });
    expect(p.approved).toBe(1);
    expect(p.inReview).toBe(1);
    expect(p.rejected).toBe(1);
    expect(p.uploaded).toBe(3);
    expect(p.hasRejected).toBe(true);
    expect(p.allApproved).toBe(false);
    expect(p.pct).toBe(25);
  });

  it('sets allApproved only when every slot is approved', () => {
    const p = getVerificationProgress({
      slots: SLOTS,
      docs: {
        a: { status: 'approved' },
        b: { status: 'approved' },
        c: { status: 'approved' },
        d: { status: 'approved' },
      },
    });
    expect(p.allApproved).toBe(true);
    expect(p.pct).toBe(100);
  });

  it('ignores docs for keys not in the slot list', () => {
    const p = getVerificationProgress({
      slots: [{ key: 'a' }],
      docs: { a: { status: 'approved' }, zzz: { status: 'approved' } },
    });
    expect(p.total).toBe(1);
    expect(p.approved).toBe(1);
    expect(p.allApproved).toBe(true);
  });

  it('is safe with null/undefined inputs', () => {
    const p = getVerificationProgress({ slots: null, docs: null });
    expect(p.total).toBe(0);
    expect(p.approved).toBe(0);
    expect(p.allApproved).toBe(false);
    expect(p.pct).toBe(0);
  });

  it('treats unknown statuses as inReview (conservative)', () => {
    const p = getVerificationProgress({
      slots: [{ key: 'a' }],
      docs: { a: { status: 'uploaded' } },
    });
    expect(p.inReview).toBe(1);
    expect(p.approved).toBe(0);
  });
});

describe('verificationStatusLabel', () => {
  it('nudges to pick personType when total=0', () => {
    expect(verificationStatusLabel({ total: 0 })).toMatch(/tipo de persona/i);
  });

  it('calls out a rejected doc as the top priority', () => {
    const p = getVerificationProgress({
      slots: SLOTS,
      docs: {
        a: { status: 'approved' },
        b: { status: 'approved' },
        c: { status: 'approved' },
        d: { status: 'rejected' },
      },
    });
    expect(verificationStatusLabel(p)).toMatch(/volver a subir/i);
  });

  it('celebrates when every doc is approved', () => {
    const p = getVerificationProgress({
      slots: SLOTS,
      docs: Object.fromEntries(SLOTS.map(s => [s.key, { status: 'approved' }])),
    });
    expect(verificationStatusLabel(p)).toMatch(/Xololo Verified/);
  });

  it('shows review state when nothing approved yet', () => {
    const p = getVerificationProgress({
      slots: SLOTS,
      docs: { a: { status: 'pending' } },
    });
    expect(verificationStatusLabel(p)).toMatch(/revisándolos/i);
  });

  it('shows mixed counter when partially approved and partially in review', () => {
    const p = getVerificationProgress({
      slots: SLOTS,
      docs: {
        a: { status: 'approved' },
        b: { status: 'pending' },
      },
    });
    expect(verificationStatusLabel(p)).toMatch(/1 aprobado/);
    expect(verificationStatusLabel(p)).toMatch(/1 en revisi/i);
  });
});
