import { describe, it, expect } from 'vitest';
import { tokenize, LexerError } from '../FormulaLexer';
import type { Token } from '../../../types/constraints';

// Helper to get token types and values without positions (for readability)
function types(tokens: Token[]) {
  return tokens.map(t => t.type);
}
function vals(tokens: Token[]) {
  return tokens.map(t => t.value);
}

describe('FormulaLexer', () => {

  // ── Numbers ──────────────────────────────────────────────────────────────

  describe('numbers', () => {
    it('tokenizes an integer', () => {
      const tokens = tokenize('42');
      expect(tokens).toHaveLength(2); // number + eof
      expect(tokens[0]).toMatchObject({ type: 'number', value: '42', position: 0 });
      expect(tokens[1].type).toBe('eof');
    });

    it('tokenizes a decimal number', () => {
      const tokens = tokenize('3.14');
      expect(tokens[0]).toMatchObject({ type: 'number', value: '3.14' });
    });

    it('tokenizes a number starting with dot', () => {
      const tokens = tokenize('.5');
      expect(tokens[0]).toMatchObject({ type: 'number', value: '.5' });
    });

    it('tokenizes scientific notation (positive exponent)', () => {
      const tokens = tokenize('1e10');
      expect(tokens[0]).toMatchObject({ type: 'number', value: '1e10' });
    });

    it('tokenizes scientific notation (negative exponent)', () => {
      const tokens = tokenize('1e-3');
      expect(tokens[0]).toMatchObject({ type: 'number', value: '1e-3' });
    });

    it('tokenizes scientific notation with E uppercase', () => {
      const tokens = tokenize('2.5E+6');
      expect(tokens[0]).toMatchObject({ type: 'number', value: '2.5E+6' });
    });

    it('tokenizes zero', () => {
      const tokens = tokenize('0');
      expect(tokens[0]).toMatchObject({ type: 'number', value: '0' });
    });
  });

  // ── Units ─────────────────────────────────────────────────────────────────

  describe('units', () => {
    it('recognizes mm unit after number', () => {
      const tokens = tokenize('300mm');
      expect(tokens).toHaveLength(3); // number + unit + eof
      expect(tokens[0]).toMatchObject({ type: 'number', value: '300' });
      expect(tokens[1]).toMatchObject({ type: 'unit', value: 'mm' });
    });

    it('recognizes m unit after number', () => {
      const tokens = tokenize('1.5m');
      expect(tokens[0]).toMatchObject({ type: 'number', value: '1.5' });
      expect(tokens[1]).toMatchObject({ type: 'unit', value: 'm' });
    });

    it('recognizes in unit after number', () => {
      const tokens = tokenize('12in');
      expect(tokens[0]).toMatchObject({ type: 'number', value: '12' });
      expect(tokens[1]).toMatchObject({ type: 'unit', value: 'in' });
    });

    it('recognizes ft unit after number', () => {
      const tokens = tokenize('6ft');
      expect(tokens[0]).toMatchObject({ type: 'number', value: '6' });
      expect(tokens[1]).toMatchObject({ type: 'unit', value: 'ft' });
    });

    it('recognizes deg unit after number', () => {
      const tokens = tokenize('90deg');
      expect(tokens[0]).toMatchObject({ type: 'number', value: '90' });
      expect(tokens[1]).toMatchObject({ type: 'unit', value: 'deg' });
    });

    it('recognizes rad unit after number', () => {
      const tokens = tokenize('3.14rad');
      expect(tokens[0]).toMatchObject({ type: 'number', value: '3.14' });
      expect(tokens[1]).toMatchObject({ type: 'unit', value: 'rad' });
    });

    it('recognizes mm2 unit after number', () => {
      const tokens = tokenize('500mm2');
      expect(tokens[0]).toMatchObject({ type: 'number', value: '500' });
      expect(tokens[1]).toMatchObject({ type: 'unit', value: 'mm2' });
    });

    it('recognizes mm3 unit after number', () => {
      const tokens = tokenize('1000mm3');
      expect(tokens[1]).toMatchObject({ type: 'unit', value: 'mm3' });
    });

    it('recognizes mm4 unit after number', () => {
      const tokens = tokenize('1000mm4');
      expect(tokens[1]).toMatchObject({ type: 'unit', value: 'mm4' });
    });

    it('recognizes kN unit after number', () => {
      const tokens = tokenize('50kN');
      expect(tokens[0]).toMatchObject({ type: 'number', value: '50' });
      expect(tokens[1]).toMatchObject({ type: 'unit', value: 'kN' });
    });

    it('recognizes MPa unit after number', () => {
      const tokens = tokenize('235MPa');
      expect(tokens[0]).toMatchObject({ type: 'number', value: '235' });
      expect(tokens[1]).toMatchObject({ type: 'unit', value: 'MPa' });
    });

    it('recognizes kg unit after number', () => {
      const tokens = tokenize('80kg');
      expect(tokens[0]).toMatchObject({ type: 'number', value: '80' });
      expect(tokens[1]).toMatchObject({ type: 'unit', value: 'kg' });
    });

    it('does not emit unit token when number is not followed by a unit suffix', () => {
      const tokens = tokenize('300');
      expect(tokens).toHaveLength(2); // number + eof only
      expect(tokens[0].type).toBe('number');
      expect(tokens[1].type).toBe('eof');
    });

    it('unit token position is immediately after number', () => {
      const tokens = tokenize('300mm');
      expect(tokens[1].position).toBe(3);
    });
  });

  // ── Arithmetic operators ──────────────────────────────────────────────────

  describe('arithmetic operators', () => {
    it('tokenizes +', () => {
      const tokens = tokenize('+');
      expect(tokens[0]).toMatchObject({ type: 'operator', value: '+' });
    });

    it('tokenizes -', () => {
      const tokens = tokenize('-');
      expect(tokens[0]).toMatchObject({ type: 'operator', value: '-' });
    });

    it('tokenizes *', () => {
      const tokens = tokenize('*');
      expect(tokens[0]).toMatchObject({ type: 'operator', value: '*' });
    });

    it('tokenizes /', () => {
      const tokens = tokenize('/');
      expect(tokens[0]).toMatchObject({ type: 'operator', value: '/' });
    });

    it('tokenizes %', () => {
      const tokens = tokenize('%');
      expect(tokens[0]).toMatchObject({ type: 'operator', value: '%' });
    });

    it('tokenizes ** (exponentiation)', () => {
      const tokens = tokenize('**');
      expect(tokens[0]).toMatchObject({ type: 'operator', value: '**' });
    });

    it('does not confuse ** with two separate *', () => {
      const tokens = tokenize('**');
      expect(tokens).toHaveLength(2); // ** + eof
    });
  });

  // ── Comparison operators ──────────────────────────────────────────────────

  describe('comparison operators', () => {
    it('tokenizes ==', () => {
      const tokens = tokenize('==');
      expect(tokens[0]).toMatchObject({ type: 'comparison', value: '==' });
    });

    it('tokenizes !=', () => {
      const tokens = tokenize('!=');
      expect(tokens[0]).toMatchObject({ type: 'comparison', value: '!=' });
    });

    it('tokenizes <', () => {
      const tokens = tokenize('<');
      expect(tokens[0]).toMatchObject({ type: 'comparison', value: '<' });
    });

    it('tokenizes >', () => {
      const tokens = tokenize('>');
      expect(tokens[0]).toMatchObject({ type: 'comparison', value: '>' });
    });

    it('tokenizes <=', () => {
      const tokens = tokenize('<=');
      expect(tokens[0]).toMatchObject({ type: 'comparison', value: '<=' });
    });

    it('tokenizes >=', () => {
      const tokens = tokenize('>=');
      expect(tokens[0]).toMatchObject({ type: 'comparison', value: '>=' });
    });
  });

  // ── Logical operators ─────────────────────────────────────────────────────

  describe('logical operators', () => {
    it('tokenizes &&', () => {
      const tokens = tokenize('&&');
      expect(tokens[0]).toMatchObject({ type: 'logical', value: '&&' });
    });

    it('tokenizes ||', () => {
      const tokens = tokenize('||');
      expect(tokens[0]).toMatchObject({ type: 'logical', value: '||' });
    });

    it('tokenizes ! as not', () => {
      const tokens = tokenize('!');
      expect(tokens[0]).toMatchObject({ type: 'not', value: '!' });
    });

    it('does not confuse ! with !=', () => {
      const tokens = tokenize('!=');
      expect(tokens[0].type).toBe('comparison');
      expect(tokens[0].value).toBe('!=');
    });
  });

  // ── Identifiers ───────────────────────────────────────────────────────────

  describe('identifiers', () => {
    it('tokenizes a simple identifier', () => {
      const tokens = tokenize('height');
      expect(tokens[0]).toMatchObject({ type: 'identifier', value: 'height' });
    });

    it('tokenizes a camelCase identifier', () => {
      const tokens = tokenize('flangeWidth');
      expect(tokens[0]).toMatchObject({ type: 'identifier', value: 'flangeWidth' });
    });

    it('tokenizes an identifier with underscore', () => {
      const tokens = tokenize('flange_width');
      expect(tokens[0]).toMatchObject({ type: 'identifier', value: 'flange_width' });
    });

    it('tokenizes an identifier with digits', () => {
      const tokens = tokenize('x1');
      expect(tokens[0]).toMatchObject({ type: 'identifier', value: 'x1' });
    });

    it('tokenizes uppercase identifier like PI', () => {
      const tokens = tokenize('PI');
      expect(tokens[0]).toMatchObject({ type: 'identifier', value: 'PI' });
    });

    it('tokenizes identifier starting with underscore', () => {
      const tokens = tokenize('_private');
      expect(tokens[0]).toMatchObject({ type: 'identifier', value: '_private' });
    });

    it('records correct position for identifier', () => {
      const tokens = tokenize('  width');
      expect(tokens[0].position).toBe(2);
    });
  });

  // ── Booleans ──────────────────────────────────────────────────────────────

  describe('booleans', () => {
    it('tokenizes true as boolean', () => {
      const tokens = tokenize('true');
      expect(tokens[0]).toMatchObject({ type: 'boolean', value: 'true' });
    });

    it('tokenizes false as boolean', () => {
      const tokens = tokenize('false');
      expect(tokens[0]).toMatchObject({ type: 'boolean', value: 'false' });
    });

    it('does not tokenize trueish as boolean', () => {
      const tokens = tokenize('trueish');
      expect(tokens[0]).toMatchObject({ type: 'identifier', value: 'trueish' });
    });

    it('does not tokenize falsehood as boolean', () => {
      const tokens = tokenize('falsehood');
      expect(tokens[0]).toMatchObject({ type: 'identifier', value: 'falsehood' });
    });
  });

  // ── Cross-object references ───────────────────────────────────────────────

  describe('cross-object references', () => {
    it('tokenizes @ symbol', () => {
      const tokens = tokenize('@');
      expect(tokens[0]).toMatchObject({ type: 'at', value: '@' });
    });

    it('tokenizes @HEA300.width as at + identifier + dot + identifier', () => {
      const tokens = tokenize('@HEA300.width');
      expect(tokens).toHaveLength(5); // at + identifier + dot + identifier + eof
      expect(tokens[0]).toMatchObject({ type: 'at', value: '@' });
      expect(tokens[1]).toMatchObject({ type: 'identifier', value: 'HEA300' });
      expect(tokens[2]).toMatchObject({ type: 'dot', value: '.' });
      expect(tokens[3]).toMatchObject({ type: 'identifier', value: 'width' });
    });

    it('tokenizes @global.verdiepingshoogte', () => {
      const tokens = tokenize('@global.verdiepingshoogte');
      expect(tokens[0]).toMatchObject({ type: 'at', value: '@' });
      expect(tokens[1]).toMatchObject({ type: 'identifier', value: 'global' });
      expect(tokens[2]).toMatchObject({ type: 'dot', value: '.' });
      expect(tokens[3]).toMatchObject({ type: 'identifier', value: 'verdiepingshoogte' });
    });

    it('records correct positions in @Kolom1.width', () => {
      const tokens = tokenize('@Kolom1.width');
      expect(tokens[0].position).toBe(0); // @
      expect(tokens[1].position).toBe(1); // Kolom1
      expect(tokens[2].position).toBe(7); // .
      expect(tokens[3].position).toBe(8); // width
    });
  });

  // ── Strings ───────────────────────────────────────────────────────────────

  describe('strings', () => {
    it('tokenizes a double-quoted string', () => {
      const tokens = tokenize('"HEA300"');
      expect(tokens[0]).toMatchObject({ type: 'string', value: 'HEA300' });
    });

    it('tokenizes an empty string', () => {
      const tokens = tokenize('""');
      expect(tokens[0]).toMatchObject({ type: 'string', value: '' });
    });

    it('tokenizes a string with spaces', () => {
      const tokens = tokenize('"hello world"');
      expect(tokens[0]).toMatchObject({ type: 'string', value: 'hello world' });
    });

    it('records the position of a string token (at opening quote)', () => {
      const tokens = tokenize('"HEA300"');
      expect(tokens[0].position).toBe(0);
    });
  });

  // ── Parentheses, comma, dot ───────────────────────────────────────────────

  describe('punctuation', () => {
    it('tokenizes (', () => {
      const tokens = tokenize('(');
      expect(tokens[0]).toMatchObject({ type: 'lparen', value: '(' });
    });

    it('tokenizes )', () => {
      const tokens = tokenize(')');
      expect(tokens[0]).toMatchObject({ type: 'rparen', value: ')' });
    });

    it('tokenizes ,', () => {
      const tokens = tokenize(',');
      expect(tokens[0]).toMatchObject({ type: 'comma', value: ',' });
    });

    it('tokenizes .', () => {
      const tokens = tokenize('.');
      expect(tokens[0]).toMatchObject({ type: 'dot', value: '.' });
    });
  });

  // ── Whitespace ────────────────────────────────────────────────────────────

  describe('whitespace', () => {
    it('skips leading whitespace', () => {
      const tokens = tokenize('   42');
      expect(tokens[0]).toMatchObject({ type: 'number', value: '42', position: 3 });
    });

    it('skips whitespace between tokens', () => {
      const tokens = tokenize('1 + 2');
      expect(types(tokens)).toEqual(['number', 'operator', 'number', 'eof']);
      expect(vals(tokens)).toEqual(['1', '+', '2', '']);
    });

    it('handles tabs and newlines', () => {
      const tokens = tokenize('\t1\n+\n2');
      expect(types(tokens)).toEqual(['number', 'operator', 'number', 'eof']);
    });
  });

  // ── EOF ───────────────────────────────────────────────────────────────────

  describe('eof', () => {
    it('always ends with eof token', () => {
      const tokens = tokenize('1 + 2');
      expect(tokens[tokens.length - 1].type).toBe('eof');
    });

    it('empty input produces only eof', () => {
      const tokens = tokenize('');
      expect(tokens).toHaveLength(1);
      expect(tokens[0]).toMatchObject({ type: 'eof', value: '', position: 0 });
    });
  });

  // ── Complex expressions ───────────────────────────────────────────────────

  describe('complex expressions', () => {
    it('tokenizes max(8, height / 40)', () => {
      const tokens = tokenize('max(8, height / 40)');
      expect(types(tokens)).toEqual([
        'identifier', // max
        'lparen',
        'number',     // 8
        'comma',
        'identifier', // height
        'operator',   // /
        'number',     // 40
        'rparen',
        'eof',
      ]);
      expect(vals(tokens)).toEqual(['max', '(', '8', ',', 'height', '/', '40', ')', '']);
    });

    it('tokenizes @Kolom1.width / 2', () => {
      const tokens = tokenize('@Kolom1.width / 2');
      expect(types(tokens)).toEqual([
        'at', 'identifier', 'dot', 'identifier', 'operator', 'number', 'eof',
      ]);
    });

    it('tokenizes a conditional expression: a > b && c <= d', () => {
      const tokens = tokenize('a > b && c <= d');
      expect(types(tokens)).toEqual([
        'identifier', 'comparison', 'identifier', 'logical', 'identifier', 'comparison', 'identifier', 'eof',
      ]);
      expect(vals(tokens.slice(0, -1))).toEqual(['a', '>', 'b', '&&', 'c', '<=', 'd']);
    });

    it('tokenizes negation: !flag', () => {
      const tokens = tokenize('!flag');
      expect(types(tokens)).toEqual(['not', 'identifier', 'eof']);
    });

    it('tokenizes power expression: 2 ** 10', () => {
      const tokens = tokenize('2 ** 10');
      expect(types(tokens)).toEqual(['number', 'operator', 'number', 'eof']);
      expect(tokens[1].value).toBe('**');
    });

    it('tokenizes 300mm + 50mm', () => {
      const tokens = tokenize('300mm + 50mm');
      expect(types(tokens)).toEqual([
        'number', 'unit', 'operator', 'number', 'unit', 'eof',
      ]);
      expect(vals(tokens)).toEqual(['300', 'mm', '+', '50', 'mm', '']);
    });

    it('tokenizes a function call with string arg: lookup("HEA300")', () => {
      const tokens = tokenize('lookup("HEA300")');
      expect(types(tokens)).toEqual([
        'identifier', 'lparen', 'string', 'rparen', 'eof',
      ]);
      expect(tokens[2].value).toBe('HEA300');
    });

    it('tokenizes a compound formula: flangeWidth * 2 + 10mm', () => {
      const tokens = tokenize('flangeWidth * 2 + 10mm');
      expect(types(tokens)).toEqual([
        'identifier', 'operator', 'number', 'operator', 'number', 'unit', 'eof',
      ]);
    });
  });

  // ── Position tracking ─────────────────────────────────────────────────────

  describe('position tracking', () => {
    it('tracks correct positions in "1 + 2"', () => {
      const tokens = tokenize('1 + 2');
      expect(tokens[0].position).toBe(0);
      expect(tokens[1].position).toBe(2);
      expect(tokens[2].position).toBe(4);
    });

    it('tracks position of operator in "height/40"', () => {
      const tokens = tokenize('height/40');
      expect(tokens[0].position).toBe(0); // height
      expect(tokens[1].position).toBe(6); // /
      expect(tokens[2].position).toBe(7); // 40
    });
  });

  // ── Error handling ────────────────────────────────────────────────────────

  describe('error handling', () => {
    it('throws LexerError on unexpected character', () => {
      expect(() => tokenize('$invalid')).toThrow(LexerError);
    });

    it('LexerError includes the position of the bad character', () => {
      try {
        tokenize('1 + $bad');
        expect.fail('should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(LexerError);
        expect((e as LexerError).position).toBe(4);
      }
    });

    it('throws LexerError for unterminated string', () => {
      expect(() => tokenize('"unterminated')).toThrow(LexerError);
    });
  });

});
