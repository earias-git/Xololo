import { LEGAL_DOC_SLOTS, slotsForPersonType } from './legalDocSlots';

describe('legalDocSlots client mirror', () => {
  describe('slotsForPersonType — modo store (default)', () => {
    it('devuelve INE, comprobante domicilio, constancia y CURP para fisica', () => {
      const keys = slotsForPersonType('fisica').map(s => s.key);
      expect(keys).toContain('identificacionOficial');
      expect(keys).toContain('comprobanteDomicilio');
      expect(keys).toContain('constanciaFiscal');
      expect(keys).toContain('curp');
    });

    it('devuelve INE, comprobante, constancia y los 3 docs de PM para moral', () => {
      const keys = slotsForPersonType('moral').map(s => s.key);
      expect(keys).toContain('identificacionOficial');
      expect(keys).toContain('comprobanteDomicilio');
      expect(keys).toContain('constanciaFiscal');
      expect(keys).toContain('actaConstitutiva');
      expect(keys).toContain('poderNotarial');
      expect(keys).toContain('ineRepresentante');
      // CURP es sólo para fisica
      expect(keys).not.toContain('curp');
    });
  });

  describe('slotsForPersonType — modo casual_reseller', () => {
    it('para fisica casual, SÓLO pide INE + comprobante de domicilio', () => {
      const keys = slotsForPersonType('fisica', 'casual_reseller').map(s => s.key);
      expect(keys).toEqual(['identificacionOficial', 'comprobanteDomicilio']);
    });

    it('omite Constancia Fiscal porque el casual tiene hasRfc=false', () => {
      const keys = slotsForPersonType('fisica', 'casual_reseller').map(s => s.key);
      expect(keys).not.toContain('constanciaFiscal');
    });

    it('omite CURP (ya aparece en la identificación oficial)', () => {
      const keys = slotsForPersonType('fisica', 'casual_reseller').map(s => s.key);
      expect(keys).not.toContain('curp');
    });

    it('ignora el modo casual para moral (no debería existir caso real pero no rompe)', () => {
      // Casual implica particular por definición; si por algún motivo se
      // combina con 'moral', el filtro de casual se aplica igual pero el
      // de personType sigue entregando los documentos de PM.
      const keys = slotsForPersonType('moral', 'casual_reseller').map(s => s.key);
      expect(keys).toContain('actaConstitutiva');
      expect(keys).not.toContain('constanciaFiscal');
    });
  });

  describe('shape del catálogo', () => {
    it('cada slot con casualOk=false también está marcado "both" o "fisica"', () => {
      // Guarda contra incoherencias: si alguien quita casualOk de un slot
      // moral, hay que repensar porque PM casual no es un flujo real.
      LEGAL_DOC_SLOTS.filter(s => s.casualOk === false).forEach(s => {
        expect(['both', 'fisica']).toContain(s.personType);
      });
    });
  });
});
