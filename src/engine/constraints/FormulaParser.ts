import { tokenize } from './FormulaLexer';
import type { Token, ASTNode, ParameterUnit } from '../../types/constraints';

// ── ParseError ────────────────────────────────────────────────────────────────

export class ParseError extends Error {
  readonly position: number;

  constructor(message: string, position: number) {
    super(`${message} (position ${position})`);
    this.name = 'ParseError';
    this.position = position;
  }
}

// ── parse ─────────────────────────────────────────────────────────────────────

/**
 * Parse a formula string into an AST.
 * Throws ParseError on syntax errors.
 */
export function parse(input: string): ASTNode {
  const tokens = tokenize(input);
  let pos = 0;

  // ── Token helpers ─────────────────────────────────────────────────────────

  function peek(offset = 0): Token {
    const i = pos + offset;
    return tokens[i] ?? tokens[tokens.length - 1]; // safe: always has eof
  }

  function advance(): Token {
    const t = tokens[pos];
    if (t.type !== 'eof') pos++;
    return t;
  }

  function expect(type: Token['type'], value?: string): Token {
    const t = peek();
    if (t.type !== type || (value !== undefined && t.value !== value)) {
      const desc = value !== undefined ? `'${value}'` : type;
      throw new ParseError(`Expected ${desc} but got '${t.value}' (${t.type})`, t.position);
    }
    return advance();
  }

  // ── Grammar (precedence, lowest → highest) ────────────────────────────────
  //
  //   1. logicalOr    ||
  //   2. logicalAnd   &&
  //   3. comparison   == != < > <= >=
  //   4. addSub       + -
  //   5. mulDiv       * / %
  //   6. power        **  (right-associative)
  //   7. unary        - !
  //   8. primary      literals, identifiers, calls, parens, cross-refs

  function parseExpression(): ASTNode {
    return parseLogicalOr();
  }

  // Level 1: ||
  function parseLogicalOr(): ASTNode {
    let left = parseLogicalAnd();
    while (peek().type === 'logical' && peek().value === '||') {
      const op = advance().value;
      const right = parseLogicalAnd();
      left = { kind: 'binary', operator: op, left, right };
    }
    return left;
  }

  // Level 2: &&
  function parseLogicalAnd(): ASTNode {
    let left = parseComparison();
    while (peek().type === 'logical' && peek().value === '&&') {
      const op = advance().value;
      const right = parseComparison();
      left = { kind: 'binary', operator: op, left, right };
    }
    return left;
  }

  // Level 3: == != < > <= >=
  function parseComparison(): ASTNode {
    let left = parseAddSub();
    while (peek().type === 'comparison') {
      const op = advance().value;
      const right = parseAddSub();
      left = { kind: 'binary', operator: op, left, right };
    }
    return left;
  }

  // Level 4: + -
  function parseAddSub(): ASTNode {
    let left = parseMulDiv();
    while (peek().type === 'operator' && (peek().value === '+' || peek().value === '-')) {
      const op = advance().value;
      const right = parseMulDiv();
      left = { kind: 'binary', operator: op, left, right };
    }
    return left;
  }

  // Level 5: * / %
  function parseMulDiv(): ASTNode {
    let left = parsePower();
    while (
      peek().type === 'operator' &&
      (peek().value === '*' || peek().value === '/' || peek().value === '%')
    ) {
      const op = advance().value;
      const right = parsePower();
      left = { kind: 'binary', operator: op, left, right };
    }
    return left;
  }

  // Level 6: ** (right-associative)
  function parsePower(): ASTNode {
    const base = parseUnary();
    if (peek().type === 'operator' && peek().value === '**') {
      advance(); // consume **
      const exponent = parsePower(); // right-recursive for right-associativity
      return { kind: 'binary', operator: '**', left: base, right: exponent };
    }
    return base;
  }

  // Level 7: unary - and !
  function parseUnary(): ASTNode {
    if (peek().type === 'operator' && peek().value === '-') {
      const t = advance();
      const operand = parseUnary();
      return { kind: 'unary', operator: '-', operand };
    }
    if (peek().type === 'not') {
      advance();
      const operand = parseUnary();
      return { kind: 'unary', operator: '!', operand };
    }
    return parsePrimary();
  }

  // Level 8: primary
  function parsePrimary(): ASTNode {
    const t = peek();

    // ── Number (optionally followed by unit token) ─────────────────────────
    if (t.type === 'number') {
      advance();
      const value = parseFloat(t.value);
      // Check for unit token immediately after
      if (peek().type === 'unit') {
        const unit = advance().value as ParameterUnit;
        return { kind: 'number', value, unit };
      }
      return { kind: 'number', value, unit: undefined };
    }

    // ── Boolean ────────────────────────────────────────────────────────────
    if (t.type === 'boolean') {
      advance();
      return { kind: 'boolean', value: t.value === 'true' };
    }

    // ── String ─────────────────────────────────────────────────────────────
    if (t.type === 'string') {
      advance();
      return { kind: 'string', value: t.value };
    }

    // ── Cross-reference: @ObjectName.paramName ─────────────────────────────
    if (t.type === 'at') {
      advance(); // consume @
      const objToken = expect('identifier');
      expect('dot');
      const paramToken = expect('identifier');
      return { kind: 'crossref', objectName: objToken.value, paramName: paramToken.value };
    }

    // ── Parenthesized expression ────────────────────────────────────────────
    if (t.type === 'lparen') {
      advance(); // consume (
      const inner = parseExpression();
      expect('rparen');
      return inner;
    }

    // ── Identifier or function call ─────────────────────────────────────────
    if (t.type === 'identifier') {
      advance();
      // Function call: identifier followed by '('
      if (peek().type === 'lparen') {
        advance(); // consume (
        const args: ASTNode[] = [];
        if (peek().type !== 'rparen') {
          args.push(parseExpression());
          while (peek().type === 'comma') {
            advance(); // consume ,
            args.push(parseExpression());
          }
        }
        expect('rparen');
        return { kind: 'call', name: t.value, args };
      }
      return { kind: 'identifier', name: t.value };
    }

    // ── Nothing matched ─────────────────────────────────────────────────────
    throw new ParseError(
      `Unexpected token '${t.value}' (${t.type})`,
      t.position
    );
  }

  // ── Entry point ──────────────────────────────────────────────────────────

  // Empty input: tokenize('') yields [eof]
  if (peek().type === 'eof') {
    throw new ParseError('Unexpected end of input', peek().position);
  }

  const result = parseExpression();

  // Ensure we consumed everything
  const remaining = peek();
  if (remaining.type !== 'eof') {
    throw new ParseError(
      `Unexpected token '${remaining.value}' (${remaining.type}) — expected end of expression`,
      remaining.position
    );
  }

  return result;
}
