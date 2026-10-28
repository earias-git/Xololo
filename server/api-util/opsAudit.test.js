// XOLOLO OPS Users 360 · Fase B — tests de notas y audit log.

const { addNote, deleteNote, recordAudit, readOpsBlock } = require('./opsAudit');

const makeMockIsdk = (initialMetadata = {}) => {
  const stored = { metadata: { ...initialMetadata } };
  return {
    _stored: stored,
    users: {
      show: jest.fn(() =>
        Promise.resolve({
          data: {
            data: {
              attributes: { profile: { metadata: stored.metadata } },
            },
          },
        })
      ),
      updateProfile: jest.fn(({ metadata }) => {
        stored.metadata = { ...stored.metadata, ...metadata };
        return Promise.resolve({ data: {} });
      }),
    },
  };
};

describe('addNote', () => {
  it('crea nota con id, timestamp, by del operator y la pone al inicio', async () => {
    const isdk = makeMockIsdk();
    const op = { id: 'op-1', email: 'kike@xololo.mx', name: 'Kike' };
    const note = await addNote({ isdk, userId: 'user-1', operator: op, text: '  hola mundo  ' });
    expect(note.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(note.text).toBe('hola mundo');
    expect(note.by).toEqual({ operatorId: 'op-1', email: 'kike@xololo.mx', name: 'Kike' });
    expect(typeof note.at).toBe('string');
    expect(isdk._stored.metadata.xololoOps.notes).toHaveLength(1);
  });

  it('nueva nota se agrega al inicio', async () => {
    const isdk = makeMockIsdk({
      xololoOps: {
        notes: [{ id: 'old', by: {}, at: '2026-01-01T00:00:00.000Z', text: 'vieja' }],
        audit: [],
      },
    });
    await addNote({ isdk, userId: 'user-1', operator: { id: 'op' }, text: 'nueva' });
    const notes = isdk._stored.metadata.xololoOps.notes;
    expect(notes).toHaveLength(2);
    expect(notes[0].text).toBe('nueva');
    expect(notes[1].id).toBe('old');
  });

  it('rechaza nota vacía', async () => {
    const isdk = makeMockIsdk();
    await expect(
      addNote({ isdk, userId: 'u', operator: {}, text: '   ' })
    ).rejects.toThrow('empty_note');
  });

  it('rechaza nota > 5000 chars', async () => {
    const isdk = makeMockIsdk();
    await expect(
      addNote({ isdk, userId: 'u', operator: {}, text: 'a'.repeat(5001) })
    ).rejects.toThrow('note_too_long');
  });
});

describe('deleteNote', () => {
  it('autor puede borrar su nota', async () => {
    const isdk = makeMockIsdk({
      xololoOps: {
        notes: [
          { id: 'n1', by: { operatorId: 'op-1' }, at: '', text: 'mia' },
        ],
        audit: [],
      },
    });
    const r = await deleteNote({ isdk, userId: 'u', noteId: 'n1', operator: { id: 'op-1' } });
    expect(r.deleted).toBe('n1');
    expect(isdk._stored.metadata.xololoOps.notes).toHaveLength(0);
  });

  it('otro operator NO puede borrarla', async () => {
    const isdk = makeMockIsdk({
      xololoOps: {
        notes: [{ id: 'n1', by: { operatorId: 'op-1' }, at: '', text: 'mia' }],
        audit: [],
      },
    });
    await expect(
      deleteNote({ isdk, userId: 'u', noteId: 'n1', operator: { id: 'op-2' } })
    ).rejects.toThrow('forbidden');
  });

  it('super_admin puede borrar nota de otro', async () => {
    const isdk = makeMockIsdk({
      xololoOps: {
        notes: [{ id: 'n1', by: { operatorId: 'op-1' }, at: '', text: 'mia' }],
        audit: [],
      },
    });
    const r = await deleteNote({
      isdk,
      userId: 'u',
      noteId: 'n1',
      operator: { id: 'op-2', role: 'super_admin' },
    });
    expect(r.deleted).toBe('n1');
  });

  it('404 si no existe', async () => {
    const isdk = makeMockIsdk({ xololoOps: { notes: [], audit: [] } });
    await expect(
      deleteNote({ isdk, userId: 'u', noteId: 'missing', operator: { id: 'op' } })
    ).rejects.toThrow('note_not_found');
  });
});

describe('recordAudit', () => {
  it('agrega entry al inicio y preserva anteriores', async () => {
    const isdk = makeMockIsdk({
      xololoOps: {
        notes: [],
        audit: [{ id: 'a1', by: {}, at: '2026-01-01', action: 'prev' }],
      },
    });
    const ok = await recordAudit({
      isdk,
      userId: 'u',
      operator: { id: 'op-1', email: 'kike@xo.mx' },
      action: 'resync_badge',
      payload: { foo: 'bar' },
      result: 'ok',
    });
    expect(ok).toBe(true);
    const audit = isdk._stored.metadata.xololoOps.audit;
    expect(audit).toHaveLength(2);
    expect(audit[0].action).toBe('resync_badge');
    expect(audit[0].payload).toEqual({ foo: 'bar' });
    expect(audit[1].id).toBe('a1');
  });

  it('nunca lanza — devuelve false si falla', async () => {
    const isdk = {
      users: {
        show: () => Promise.reject(new Error('down')),
        updateProfile: jest.fn(),
      },
    };
    const ok = await recordAudit({ isdk, userId: 'u', operator: {}, action: 'x' });
    expect(ok).toBe(false);
  });
});

describe('readOpsBlock', () => {
  it('user sin metadata → objeto vacío', () => {
    expect(readOpsBlock({})).toEqual({ notes: [], audit: [] });
  });
  it('user con metadata.xololoOps → ese bloque', () => {
    const u = {
      attributes: {
        profile: {
          metadata: { xololoOps: { notes: [{ id: 'n1' }], audit: [] } },
        },
      },
    };
    expect(readOpsBlock(u).notes).toHaveLength(1);
  });
});
