import type { Token, TokenType, ParameterUnit } from '../../types/constraints';

// ── LexerError ───────────────────────────────────────────────────────────────

export class LexerError extends Error {
  readonly position: number;

  constructor(message: string, position: number) {
    super(`${message} (position ${position})`);
    this.name = 'LexerError';
    this.position = position;
  }
}

// ── Unit suffixes (longest match first to avoid 'mm' beating 'mm2') ─────────

const UNIT_SUFFIXES: ParameterUnit[] = [
  'mm4', 'mm3', 'mm2', 'MPa', 'kN', 'deg', 'rad', 'mm', 'kg', 'ft', 'in', 'm',
];

// ── tokenize ─────────────────────────────────────────────────────────────────

/**
 * Converts a formula string into a flat array of Token objects.
 * The array always ends with a single 'eof' token.
 * Throws LexerError for unrecognised characters or unterminated strings.
 */
export function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let pos = 0;

  function peek(offset = 0): string {
    return input[pos + offset] ?? '';
  }

  function advance(n = 1): string {
    const s = input.slice(pos, pos + n);
    pos += n;
    return s;
  }

  function push(type: TokenType, value: string, position: number): void {
    tokens.push({ type, value, position });
  }

  while (pos < input.length) {
    // ── Skip whitespace ────────────────────────────────────────────────────
    if (/\s/.test(peek())) {
      pos++;
      continue;
    }

    const start = pos;
    const ch = peek();

    // ── Double-quoted string ───────────────────────────────────────────────
    if (ch === '"') {
      pos++; // skip opening quote
      let str = '';
      while (pos < input.length && peek() !== '"') {
        str += advance();
      }
      if (pos >= input.length) {
        throw new LexerError('Unterminated string literal', start);
      }
      pos++; // skip closing quote
      push('string', str, start);
      continue;
    }

    // ── Number (int, float, scientific) ───────────────────────────────────
    // Entry: ch is a digit, OR ch is '.' followed by a digit
    if ((ch >= '0' && ch <= '9') || (ch === '.' && peek(1) >= '0' && peek(1) <= '9')) {
      let num = '';

      // If we start with '.', skip the integer-digit phase
      if (ch !== '.') {
        // Consume leading integer digits
        while (pos < input.length && peek() >= '0' && peek() <= '9') {
          num += advance();
        }
      }

      // Optional fractional part (including the case where we started with '.')
      if (peek() === '.' && peek(1) >= '0' && peek(1) <= '9') {
        num += advance(); // consume '.'
        while (pos < input.length && peek() >= '0' && peek() <= '9') {
          num += advance();
        }
      }

      // Optional exponent: e/E followed by optional +/- and digits
      if (peek() === 'e' || peek() === 'E') {
        const savedPos = pos;
        const savedNum = num;
        num += advance(); // e/E
        if (peek() === '+' || peek() === '-') {
          num += advance();
        }
        if (peek() >= '0' && peek() <= '9') {
          while (pos < input.length && peek() >= '0' && peek() <= '9') {
            num += advance();
          }
        } else {
          // not a valid exponent — backtrack
          pos = savedPos;
          num = savedNum;
        }
      }
      push('number', num, start);

      // Check for a unit suffix immediately after the number (no whitespace)
      const unitStart = pos;
      for (const unit of UNIT_SUFFIXES) {
        if (input.startsWith(unit, pos)) {
          // Make sure the character after the unit is NOT a letter/digit
          // (so 'min' doesn't match 'm' and leave 'in', for example)
          const after = input[pos + unit.length];
          if (after === undefined || !/[a-zA-Z0-9_]/.test(after)) {
            pos += unit.length;
            push('unit', unit, unitStart);
            break;
          }
        }
      }
      continue;
    }

    // ── Dot (standalone — after number is handled above) ──────────────────
    if (ch === '.') {
      advance();
      push('dot', '.', start);
      continue;
    }

    // ── @ symbol ──────────────────────────────────────────────────────────
    if (ch === '@') {
      advance();
      push('at', '@', start);
      continue;
    }

    // ── Parentheses / comma ────────────────────────────────────────────────
    if (ch === '(') { advance(); push('lparen', '(', start); continue; }
    if (ch === ')') { advance(); push('rparen', ')', start); continue; }
    if (ch === ',') { advance(); push('comma', ',', start); continue; }

    // ── Two-char operators ─────────────────────────────────────────────────
    const two = input.slice(pos, pos + 2);

    if (two === '**') { advance(2); push('operator', '**', start); continue; }
    if (two === '==') { advance(2); push('comparison', '==', start); continue; }
    if (two === '!=') { advance(2); push('comparison', '!=', start); continue; }
    if (two === '<=') { advance(2); push('comparison', '<=', start); continue; }
    if (two === '>=') { advance(2); push('comparison', '>=', start); continue; }
    if (two === '&&') { advance(2); push('logical', '&&', start); continue; }
    if (two === '||') { advance(2); push('logical', '||', start); continue; }

    // ── Single-char arithmetic operators ──────────────────────────────────
    if (ch === '+' || ch === '-' || ch === '*' || ch === '/' || ch === '%') {
      advance();
      push('operator', ch, start);
      continue;
    }

    // ── Single-char comparison ─────────────────────────────────────────────
    if (ch === '<' || ch === '>') {
      advance();
      push('comparison', ch, start);
      continue;
    }

    // ── Not operator ──────────────────────────────────────────────────────
    if (ch === '!') {
      advance();
      push('not', '!', start);
      continue;
    }

    // ── Identifiers and keywords (true / false) ───────────────────────────
    if (/[a-zA-Z_]/.test(ch)) {
      let ident = '';
      while (pos < input.length && /[a-zA-Z0-9_]/.test(peek())) {
        ident += advance();
      }
      if (ident === 'true' || ident === 'false') {
        push('boolean', ident, start);
      } else {
        push('identifier', ident, start);
      }
      continue;
    }

    // ── Unexpected character ───────────────────────────────────────────────
    throw new LexerError(`Unexpected character: '${ch}'`, pos);
  }

  // Always end with eof
  push('eof', '', pos);
  return tokens;
}
