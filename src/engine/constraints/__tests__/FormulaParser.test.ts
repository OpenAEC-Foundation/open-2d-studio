import { describe, it, expect } from 'vitest';
import { parse, ParseError } from '../FormulaParser';
import type {
  ASTNode,
  NumberLiteral,
  BooleanLiteral,
  StringLiteral,
  Identifier,
  UnaryExpression,
  BinaryExpression,
  FunctionCall,
  CrossReference,
} from '../../../types/constraints';

// ── Helpers ───────────────────────────────────────────────────────────────────

function num(value: number, unit?: string): NumberLiteral {
  return unit
    ? { kind: 'number', value, unit: unit as NumberLiteral['unit'] }
    : { kind: 'number', value, unit: undefined };
}

function bool(value: boolean): BooleanLiteral {
  return { kind: 'boolean', value };
}

function str(value: string): StringLiteral {
  return { kind: 'string', value };
}

function ident(name: string): Identifier {
  return { kind: 'identifier', name };
}

function unary(operator: string, operand: ASTNode): UnaryExpression {
  return { kind: 'unary', operator, operand };
}

function binary(operator: string, left: ASTNode, right: ASTNode): BinaryExpression {
  return { kind: 'binary', operator, left, right };
}

function call(name: string, args: ASTNode[]): FunctionCall {
  return { kind: 'call', name, args };
}

function crossref(objectName: string, paramName: string): CrossReference {
  return { kind: 'crossref', objectName, paramName };
}

// ── Literals ──────────────────────────────────────────────────────────────────

describe('FormulaParser', () => {

  describe('literals', () => {
    it('parses an integer literal', () => {
      expect(parse('42')).toEqual(num(42));
    });

    it('parses a decimal literal', () => {
      expect(parse('3.14')).toEqual(num(3.14));
    });

    it('parses a number with unit (mm)', () => {
      expect(parse('150mm')).toEqual(num(150, 'mm'));
    });

    it('parses a number with unit (m)', () => {
      expect(parse('1.5m')).toEqual(num(1.5, 'm'));
    });

    it('parses a number with unit (deg)', () => {
      expect(parse('45deg')).toEqual(num(45, 'deg'));
    });

    it('parses a number with unit (kN)', () => {
      expect(parse('50kN')).toEqual(num(50, 'kN'));
    });

    it('parses a number without unit — unit field is undefined', () => {
      const result = parse('42') as NumberLiteral;
      expect(result.kind).toBe('number');
      expect(result.unit).toBeUndefined();
    });

    it('parses boolean true', () => {
      expect(parse('true')).toEqual(bool(true));
    });

    it('parses boolean false', () => {
      expect(parse('false')).toEqual(bool(false));
    });

    it('parses a double-quoted string', () => {
      expect(parse('"hello"')).toEqual(str('hello'));
    });

    it('parses an empty string', () => {
      expect(parse('""')).toEqual(str(''));
    });

    it('parses a string with spaces', () => {
      expect(parse('"hello world"')).toEqual(str('hello world'));
    });
  });

  // ── Identifiers ─────────────────────────────────────────────────────────────

  describe('identifiers', () => {
    it('parses a simple identifier', () => {
      expect(parse('height')).toEqual(ident('height'));
    });

    it('parses a camelCase identifier', () => {
      expect(parse('flangeWidth')).toEqual(ident('flangeWidth'));
    });

    it('parses an identifier with underscore', () => {
      expect(parse('flange_width')).toEqual(ident('flange_width'));
    });

    it('parses identifier starting with underscore', () => {
      expect(parse('_private')).toEqual(ident('_private'));
    });
  });

  // ── Arithmetic ───────────────────────────────────────────────────────────────

  describe('arithmetic', () => {
    it('parses addition (a + b)', () => {
      expect(parse('a + b')).toEqual(binary('+', ident('a'), ident('b')));
    });

    it('parses subtraction (a - b)', () => {
      expect(parse('a - b')).toEqual(binary('-', ident('a'), ident('b')));
    });

    it('parses multiplication (a * b)', () => {
      expect(parse('a * b')).toEqual(binary('*', ident('a'), ident('b')));
    });

    it('parses division (a / b)', () => {
      expect(parse('a / b')).toEqual(binary('/', ident('a'), ident('b')));
    });

    it('parses modulo (a % b)', () => {
      expect(parse('a % b')).toEqual(binary('%', ident('a'), ident('b')));
    });

    it('respects precedence: a + b * c — outer is +, right child is *', () => {
      const result = parse('a + b * c') as BinaryExpression;
      expect(result.kind).toBe('binary');
      expect(result.operator).toBe('+');
      expect(result.left).toEqual(ident('a'));
      expect(result.right).toEqual(binary('*', ident('b'), ident('c')));
    });

    it('respects precedence: a * b + c — outer is +, left child is *', () => {
      const result = parse('a * b + c') as BinaryExpression;
      expect(result.operator).toBe('+');
      expect(result.left).toEqual(binary('*', ident('a'), ident('b')));
      expect(result.right).toEqual(ident('c'));
    });

    it('parses power operator (x ** 2)', () => {
      expect(parse('x ** 2')).toEqual(binary('**', ident('x'), num(2)));
    });

    it('parses chained power right-associatively (x ** 2 ** 3 → x ** (2 ** 3))', () => {
      // Power is right-associative
      const result = parse('x ** 2 ** 3') as BinaryExpression;
      expect(result.operator).toBe('**');
      expect(result.left).toEqual(ident('x'));
      expect(result.right).toEqual(binary('**', num(2), num(3)));
    });

    it('parses unary minus (-x)', () => {
      expect(parse('-x')).toEqual(unary('-', ident('x')));
    });

    it('parses unary minus on literal (-42)', () => {
      expect(parse('-42')).toEqual(unary('-', num(42)));
    });

    it('parses parenthesized expression ((a + b) * c)', () => {
      expect(parse('(a + b) * c')).toEqual(
        binary('*', binary('+', ident('a'), ident('b')), ident('c'))
      );
    });

    it('parses nested parentheses ((a))', () => {
      expect(parse('((a))')).toEqual(ident('a'));
    });

    it('parses height * 0.5', () => {
      expect(parse('height * 0.5')).toEqual(binary('*', ident('height'), num(0.5)));
    });
  });

  // ── Comparison and logical ────────────────────────────────────────────────────

  describe('comparison and logical', () => {
    it('parses greater-than (height > 200)', () => {
      expect(parse('height > 200')).toEqual(binary('>', ident('height'), num(200)));
    });

    it('parses less-than (a < b)', () => {
      expect(parse('a < b')).toEqual(binary('<', ident('a'), ident('b')));
    });

    it('parses greater-or-equal (a >= b)', () => {
      expect(parse('a >= b')).toEqual(binary('>=', ident('a'), ident('b')));
    });

    it('parses less-or-equal (a <= b)', () => {
      expect(parse('a <= b')).toEqual(binary('<=', ident('a'), ident('b')));
    });

    it('parses equality (a == b)', () => {
      expect(parse('a == b')).toEqual(binary('==', ident('a'), ident('b')));
    });

    it('parses inequality (a != b)', () => {
      expect(parse('a != b')).toEqual(binary('!=', ident('a'), ident('b')));
    });

    it('parses logical AND — outer is &&, children are comparisons', () => {
      const result = parse('a > 0 && b > 0') as BinaryExpression;
      expect(result.kind).toBe('binary');
      expect(result.operator).toBe('&&');
      expect(result.left).toEqual(binary('>', ident('a'), num(0)));
      expect(result.right).toEqual(binary('>', ident('b'), num(0)));
    });

    it('parses logical OR (a || b)', () => {
      expect(parse('a || b')).toEqual(binary('||', ident('a'), ident('b')));
    });

    it('parses unary NOT (!a)', () => {
      expect(parse('!a')).toEqual(unary('!', ident('a')));
    });

    it('parses NOT on expression (!( a > 0))', () => {
      expect(parse('!(a > 0)')).toEqual(unary('!', binary('>', ident('a'), num(0))));
    });

    it('&& has lower precedence than comparison (a > 0 && b > 0)', () => {
      const result = parse('a > 0 && b > 0') as BinaryExpression;
      expect(result.operator).toBe('&&');
    });

    it('|| has lower precedence than && (a && b || c)', () => {
      const result = parse('a && b || c') as BinaryExpression;
      expect(result.operator).toBe('||');
      expect(result.left).toEqual(binary('&&', ident('a'), ident('b')));
      expect(result.right).toEqual(ident('c'));
    });
  });

  // ── Function calls ───────────────────────────────────────────────────────────

  describe('function calls', () => {
    it('parses a zero-argument call (rand())', () => {
      expect(parse('rand()')).toEqual(call('rand', []));
    });

    it('parses a single-argument call (sin(45))', () => {
      expect(parse('sin(45)')).toEqual(call('sin', [num(45)]));
    });

    it('parses a call with identifier arg (sin(x))', () => {
      expect(parse('sin(x)')).toEqual(call('sin', [ident('x')]));
    });

    it('parses multi-argument call (max(8, height / 40))', () => {
      expect(parse('max(8, height / 40)')).toEqual(
        call('max', [num(8), binary('/', ident('height'), num(40))])
      );
    });

    it('parses three-argument call (clamp(x, 0, 100))', () => {
      expect(parse('clamp(x, 0, 100)')).toEqual(
        call('clamp', [ident('x'), num(0), num(100)])
      );
    });

    it('parses clamp(thickness * 0.3, 3, 15)', () => {
      expect(parse('clamp(thickness * 0.3, 3, 15)')).toEqual(
        call('clamp', [
          binary('*', ident('thickness'), num(0.3)),
          num(3),
          num(15),
        ])
      );
    });

    it('parses nested function calls (max(abs(x), abs(y)))', () => {
      expect(parse('max(abs(x), abs(y))')).toEqual(
        call('max', [
          call('abs', [ident('x')]),
          call('abs', [ident('y')]),
        ])
      );
    });

    it('parses function call in arithmetic expression (sin(x) + cos(y))', () => {
      expect(parse('sin(x) + cos(y)')).toEqual(
        binary('+', call('sin', [ident('x')]), call('cos', [ident('y')]))
      );
    });
  });

  // ── Cross-references ─────────────────────────────────────────────────────────

  describe('cross-references', () => {
    it('parses @HEA300.width', () => {
      expect(parse('@HEA300.width')).toEqual(crossref('HEA300', 'width'));
    });

    it('parses @global.verdiepingshoogte', () => {
      expect(parse('@global.verdiepingshoogte')).toEqual(
        crossref('global', 'verdiepingshoogte')
      );
    });

    it('parses @Kolom1.width in an expression (@Kolom1.width / 2)', () => {
      expect(parse('@Kolom1.width / 2')).toEqual(
        binary('/', crossref('Kolom1', 'width'), num(2))
      );
    });

    it('parses cross-ref in arithmetic (@Slab1.thickness + 5)', () => {
      expect(parse('@Slab1.thickness + 5')).toEqual(
        binary('+', crossref('Slab1', 'thickness'), num(5))
      );
    });
  });

  // ── Complex formulas from spec ────────────────────────────────────────────────

  describe('complex formulas from spec', () => {
    it('parses height * 0.5', () => {
      expect(parse('height * 0.5')).toEqual(binary('*', ident('height'), num(0.5)));
    });

    it('parses max(8, height / 40)', () => {
      expect(parse('max(8, height / 40)')).toEqual(
        call('max', [num(8), binary('/', ident('height'), num(40))])
      );
    });

    it('parses 2 * flangeWidth * flangeThickness + (height - 2 * flangeThickness) * webThickness', () => {
      // 2 * flangeWidth * flangeThickness + (height - 2 * flangeThickness) * webThickness
      // Left-to-right for same precedence:
      // ((2 * flangeWidth) * flangeThickness) + ((height - (2 * flangeThickness)) * webThickness)
      const result = parse('2 * flangeWidth * flangeThickness + (height - 2 * flangeThickness) * webThickness');
      expect(result).toMatchObject({
        kind: 'binary',
        operator: '+',
      });
      const b = result as BinaryExpression;
      // Left: ((2 * flangeWidth) * flangeThickness)
      expect(b.left).toEqual(
        binary('*',
          binary('*', num(2), ident('flangeWidth')),
          ident('flangeThickness')
        )
      );
      // Right: (height - 2 * flangeThickness) * webThickness
      expect(b.right).toEqual(
        binary('*',
          binary('-', ident('height'), binary('*', num(2), ident('flangeThickness'))),
          ident('webThickness')
        )
      );
    });

    it('parses clamp(thickness * 0.3, 3, 15)', () => {
      expect(parse('clamp(thickness * 0.3, 3, 15)')).toEqual(
        call('clamp', [
          binary('*', ident('thickness'), num(0.3)),
          num(3),
          num(15),
        ])
      );
    });
  });

  // ── Error handling ────────────────────────────────────────────────────────────

  describe('error handling', () => {
    it('throws ParseError for empty input', () => {
      expect(() => parse('')).toThrow(ParseError);
    });

    it('throws ParseError for unexpected token at start (+)', () => {
      expect(() => parse('+')).toThrow(ParseError);
    });

    it('throws ParseError for unclosed parenthesis ((a + b)', () => {
      expect(() => parse('(a + b')).toThrow(ParseError);
    });

    it('throws ParseError for leftover tokens after expression (a b)', () => {
      expect(() => parse('a b')).toThrow(ParseError);
    });

    it('throws ParseError for dangling operator (a +)', () => {
      expect(() => parse('a +')).toThrow(ParseError);
    });

    it('ParseError has a position property', () => {
      try {
        parse('(a + b');
        expect.fail('should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(ParseError);
        expect(typeof (e as ParseError).position).toBe('number');
      }
    });

    it('throws ParseError for incomplete cross-reference (@HEA300)', () => {
      expect(() => parse('@HEA300')).toThrow(ParseError);
    });

    it('throws ParseError for cross-reference without param name (@HEA300.)', () => {
      expect(() => parse('@HEA300.')).toThrow(ParseError);
    });
  });

});
