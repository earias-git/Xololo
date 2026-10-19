import {
  NOTICE,
  USED_CONDITIONS,
  USED_CONDITION_OPTIONS,
  getUsedConditionLabel,
} from './xololoUsedCondition';

describe('xololoUsedCondition', () => {
  it('expone 5 niveles de estado', () => {
    expect(USED_CONDITION_OPTIONS).toHaveLength(5);
  });

  it('todos los códigos tienen una option con label definido', () => {
    Object.values(USED_CONDITIONS).forEach(code => {
      const opt = USED_CONDITION_OPTIONS.find(o => o.key === code);
      expect(opt).toBeDefined();
      expect(typeof opt.label).toBe('string');
      expect(opt.label.length).toBeGreaterThan(10);
    });
  });

  describe('getUsedConditionLabel', () => {
    it('devuelve el label humano para un código válido', () => {
      expect(getUsedConditionLabel(USED_CONDITIONS.LIKE_NEW)).toMatch(/nuevo/i);
      expect(getUsedConditionLabel(USED_CONDITIONS.POOR)).toMatch(/mal estado/i);
    });

    it('devuelve null para un código inexistente', () => {
      expect(getUsedConditionLabel(null)).toBeNull();
      expect(getUsedConditionLabel('')).toBeNull();
      expect(getUsedConditionLabel('como_destruido')).toBeNull();
    });
  });

  it('NOTICE menciona que se compra "como usado" y pide revisar al recibir', () => {
    expect(NOTICE).toMatch(/como usado|as-is/i);
    expect(NOTICE).toMatch(/rev[ií]s/i);
  });
});
