import { describe, it, expect } from 'vitest';
import { evaluate, EvaluationError } from '../FormulaEvaluator';

// ── Helpers ───────────────────────────────────────────────────────────────────

const EMPTY = {} as Record<string, number | boolean | string>;

// ── Arithmetic ────────────────────────────────────────────────────────────────

describe('Arithmetic', () => {
  it('literal 42 → 42', () => {
    expect(evaluate('42', EMPTY)).toBe(42);
  });

  it('10 + 20 → 30', () => {
    expect(evaluate('10+20', EMPTY)).toBe(30);
  });

  it('2*3+4 → 10 (operator precedence)', () => {
    expect(evaluate('2*3+4', EMPTY)).toBe(10);
  });

  it('2**3 → 8 (exponentiation)', () => {
    expect(evaluate('2**3', EMPTY)).toBe(8);
  });

  it('10%3 → 1 (modulo)', () => {
    expect(evaluate('10%3', EMPTY)).toBe(1);
  });

  it('-5 → -5 (unary negation)', () => {
    expect(evaluate('-5', EMPTY)).toBe(-5);
  });

  it('(2+3)*4 → 20 (parentheses)', () => {
    expect(evaluate('(2+3)*4', EMPTY)).toBe(20);
  });

  it('division by zero throws EvaluationError', () => {
    expect(() => evaluate('10/0', EMPTY)).toThrow(EvaluationError);
  });
});

// ── Unit Conversion ───────────────────────────────────────────────────────────

describe('Unit conversion', () => {
  it('150mm → 150 (mm is base unit)', () => {
    expect(evaluate('150mm', EMPTY)).toBe(150);
  });

  it('0.15m → 150 (metres to mm)', () => {
    expect(evaluate('0.15m', EMPTY)).toBeCloseTo(150, 5);
  });

  it('1in → 25.4 (inches to mm)', () => {
    expect(evaluate('1in', EMPTY)).toBeCloseTo(25.4, 5);
  });

  it('1ft → 304.8 (feet to mm)', () => {
    expect(evaluate('1ft', EMPTY)).toBeCloseTo(304.8, 5);
  });

  it('3.14159265rad → ~180 (radians to degrees)', () => {
    expect(evaluate('3.14159265rad', EMPTY)).toBeCloseTo(180, 3);
  });

  it('45deg → 45 (degrees is base unit)', () => {
    expect(evaluate('45deg', EMPTY)).toBe(45);
  });
});

// ── Variables ─────────────────────────────────────────────────────────────────

describe('Variables', () => {
  it('height with {height:300} → 300', () => {
    expect(evaluate('height', { height: 300 })).toBe(300);
  });

  it('height*0.5 with {height:300} → 150', () => {
    expect(evaluate('height*0.5', { height: 300 })).toBe(150);
  });

  it('unknown variable throws EvaluationError', () => {
    expect(() => evaluate('unknownVar', EMPTY)).toThrow(EvaluationError);
  });
});

// ── Comparison and Logical ────────────────────────────────────────────────────

describe('Comparison and logical operators', () => {
  it('10>5 → true', () => {
    expect(evaluate('10>5', EMPTY)).toBe(true);
  });

  it('10==10 → true', () => {
    expect(evaluate('10==10', EMPTY)).toBe(true);
  });

  it('10!=5 → true', () => {
    expect(evaluate('10!=5', EMPTY)).toBe(true);
  });

  it('10<5 → false', () => {
    expect(evaluate('10<5', EMPTY)).toBe(false);
  });

  it('10>=10 → true', () => {
    expect(evaluate('10>=10', EMPTY)).toBe(true);
  });

  it('true&&false → false', () => {
    expect(evaluate('true&&false', EMPTY)).toBe(false);
  });

  it('true||false → true', () => {
    expect(evaluate('true||false', EMPTY)).toBe(true);
  });

  it('!true → false', () => {
    expect(evaluate('!true', EMPTY)).toBe(false);
  });

  it('!false → true', () => {
    expect(evaluate('!false', EMPTY)).toBe(true);
  });
});

// ── Trig Functions (degrees) ──────────────────────────────────────────────────

describe('Trig functions (input/output in degrees)', () => {
  it('sin(90) → ~1', () => {
    expect(evaluate('sin(90)', EMPTY)).toBeCloseTo(1, 10);
  });

  it('cos(0) → ~1', () => {
    expect(evaluate('cos(0)', EMPTY)).toBeCloseTo(1, 10);
  });

  it('tan(45) → ~1', () => {
    expect(evaluate('tan(45)', EMPTY)).toBeCloseTo(1, 10);
  });

  it('asin(1) → ~90', () => {
    expect(evaluate('asin(1)', EMPTY)).toBeCloseTo(90, 5);
  });

  it('acos(1) → ~0', () => {
    expect(evaluate('acos(1)', EMPTY)).toBeCloseTo(0, 5);
  });

  it('atan(1) → ~45', () => {
    expect(evaluate('atan(1)', EMPTY)).toBeCloseTo(45, 5);
  });

  it('atan2(1,1) → ~45', () => {
    expect(evaluate('atan2(1,1)', EMPTY)).toBeCloseTo(45, 5);
  });
});

// ── Math Functions ────────────────────────────────────────────────────────────

describe('Math functions', () => {
  it('sqrt(16) → 4', () => {
    expect(evaluate('sqrt(16)', EMPTY)).toBe(4);
  });

  it('abs(-5) → 5', () => {
    expect(evaluate('abs(-5)', EMPTY)).toBe(5);
  });

  it('pow(2,10) → 1024', () => {
    expect(evaluate('pow(2,10)', EMPTY)).toBe(1024);
  });

  it('exp(0) → 1', () => {
    expect(evaluate('exp(0)', EMPTY)).toBe(1);
  });

  it('ln(1) → 0', () => {
    expect(evaluate('ln(1)', EMPTY)).toBe(0);
  });

  it('log10(100) → 2', () => {
    expect(evaluate('log10(100)', EMPTY)).toBe(2);
  });

  it('sign(-5) → -1', () => {
    expect(evaluate('sign(-5)', EMPTY)).toBe(-1);
  });

  it('sign(5) → 1', () => {
    expect(evaluate('sign(5)', EMPTY)).toBe(1);
  });

  it('sign(0) → 0', () => {
    expect(evaluate('sign(0)', EMPTY)).toBe(0);
  });
});

// ── Rounding and Range ────────────────────────────────────────────────────────

describe('Rounding and range functions', () => {
  it('round(3.7) → 4', () => {
    expect(evaluate('round(3.7)', EMPTY)).toBe(4);
  });

  it('round(3.14159,2) → ~3.14', () => {
    expect(evaluate('round(3.14159,2)', EMPTY)).toBeCloseTo(3.14, 5);
  });

  it('floor(3.7) → 3', () => {
    expect(evaluate('floor(3.7)', EMPTY)).toBe(3);
  });

  it('ceil(3.2) → 4', () => {
    expect(evaluate('ceil(3.2)', EMPTY)).toBe(4);
  });

  it('min(5,3,8) → 3', () => {
    expect(evaluate('min(5,3,8)', EMPTY)).toBe(3);
  });

  it('max(5,3,8) → 8', () => {
    expect(evaluate('max(5,3,8)', EMPTY)).toBe(8);
  });

  it('clamp(15,0,10) → 10 (above max)', () => {
    expect(evaluate('clamp(15,0,10)', EMPTY)).toBe(10);
  });

  it('clamp(-5,0,10) → 0 (below min)', () => {
    expect(evaluate('clamp(-5,0,10)', EMPTY)).toBe(0);
  });

  it('clamp(5,0,10) → 5 (within range)', () => {
    expect(evaluate('clamp(5,0,10)', EMPTY)).toBe(5);
  });

  it('lerp(0,100,0.5) → 50', () => {
    expect(evaluate('lerp(0,100,0.5)', EMPTY)).toBe(50);
  });

  it('map(5,0,10,0,100) → 50', () => {
    expect(evaluate('map(5,0,10,0,100)', EMPTY)).toBe(50);
  });
});

// ── Conditional Functions ─────────────────────────────────────────────────────

describe('Conditional functions', () => {
  it('if(true,10,20) → 10', () => {
    expect(evaluate('if(true,10,20)', EMPTY)).toBe(10);
  });

  it('if(false,10,20) → 20', () => {
    expect(evaluate('if(false,10,20)', EMPTY)).toBe(20);
  });

  it('if(height>200,12,8) with {height:300} → 12', () => {
    expect(evaluate('if(height>200,12,8)', { height: 300 })).toBe(12);
  });

  it('if(height>200,12,8) with {height:100} → 8', () => {
    expect(evaluate('if(height>200,12,8)', { height: 100 })).toBe(8);
  });

  it('select(1,10,20,30) → 20 (zero-based index)', () => {
    expect(evaluate('select(1,10,20,30)', EMPTY)).toBe(20);
  });

  it('select(0,10,20,30) → 10', () => {
    expect(evaluate('select(0,10,20,30)', EMPTY)).toBe(10);
  });
});

// ── Constants ─────────────────────────────────────────────────────────────────

describe('Constants', () => {
  it('PI → ~3.14159', () => {
    expect(evaluate('PI', EMPTY)).toBeCloseTo(3.14159265358979, 10);
  });

  it('TAU → ~6.28318', () => {
    expect(evaluate('TAU', EMPTY)).toBeCloseTo(6.28318530717959, 10);
  });

  it('E → ~2.71828', () => {
    expect(evaluate('E', EMPTY)).toBeCloseTo(2.71828182845905, 10);
  });

  it('SQRT2 → ~1.41421', () => {
    expect(evaluate('SQRT2', EMPTY)).toBeCloseTo(1.41421356237310, 10);
  });
});

// ── Cross Reference ───────────────────────────────────────────────────────────

describe('Cross references', () => {
  it('@Beam.height throws EvaluationError (must be resolved before evaluation)', () => {
    expect(() => evaluate('@Beam.height', EMPTY)).toThrow(EvaluationError);
  });
});

// ── Spec Formulas ─────────────────────────────────────────────────────────────

describe('Spec formulas', () => {
  const ctx = {
    height: 300,
    flangeWidth: 150,
    flangeThickness: 14,
    webThickness: 8,
    thickness: 20,
  };

  it('height*0.5 → 150', () => {
    expect(evaluate('height*0.5', ctx)).toBe(150);
  });

  it('max(8,height/40) → 8 (since 300/40=7.5)', () => {
    expect(evaluate('max(8,height/40)', ctx)).toBe(8);
  });

  it('if(height>200,12,8) → 12', () => {
    expect(evaluate('if(height>200,12,8)', ctx)).toBe(12);
  });

  it('clamp(thickness*0.3,3,15) → 6', () => {
    expect(evaluate('clamp(thickness*0.3,3,15)', ctx)).toBe(6);
  });

  it('I-section area formula → 6376', () => {
    // 2*flangeWidth*flangeThickness + (height-2*flangeThickness)*webThickness
    // = 2*150*14 + (300-28)*8 = 4200 + 2176 = 6376
    expect(
      evaluate(
        '2*flangeWidth*flangeThickness+(height-2*flangeThickness)*webThickness',
        ctx
      )
    ).toBe(6376);
  });
});
