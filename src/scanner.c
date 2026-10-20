#include "tree_sitter/parser.h"

#include <stdbool.h>
#include <stdint.h>

// External tokens, in the same order as `externals` in grammar.js.
// FLOAT_TRAILING_DOT is every number the internal patterns split or miss.
// A regex cannot see that `1.` is not `1...`, and it cannot keep a missing
// exponent digit, a short `0x`/`0b`, or a bad suffix inside the literal.
// The span matches Lexer::lex_number_or_float. Well-formed numbers that the
// grammar already matches are returned too; a shorter internal match loses.
enum TokenType {
    COMMENT,
    FLOAT_TRAILING_DOT,
};

static void advance(TSLexer *lexer) { lexer->advance(lexer, false); }

static bool is_digit(int32_t c) { return c >= '0' && c <= '9'; }

static bool is_ident_start(int32_t c) {
    return (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || c == '_';
}

static bool is_ident_continue(int32_t c) { return is_ident_start(c) || is_digit(c); }

static int hex_value(int32_t c) {
    if (c >= '0' && c <= '9') {
        return (int)(c - '0');
    }
    if (c >= 'a' && c <= 'f') {
        return (int)(c - 'a' + 10);
    }
    if (c >= 'A' && c <= 'F') {
        return (int)(c - 'A' + 10);
    }
    return -1;
}

// Digit value for this base, or -1. Base 10 rejects a-f. Base 16 accepts them.
static int digit_of(int32_t c, int base) {
    const int value = hex_value(c);
    if (value < 0 || value >= base) {
        return -1;
    }
    return value;
}

// `//` to the end of the line, or `/* ... */`. A missing `*/` runs to the
// end of the file. `/` and `/=` are not comments.
static bool scan_comment(TSLexer *lexer) {
    if (lexer->lookahead != '/') {
        return false;
    }
    advance(lexer);
    if (lexer->lookahead == '/') {
        advance(lexer);
        while (!lexer->eof(lexer) && lexer->lookahead != '\n') {
            advance(lexer);
        }
        lexer->mark_end(lexer);
        lexer->result_symbol = COMMENT;
        return true;
    }
    if (lexer->lookahead != '*') {
        return false;
    }
    advance(lexer);
    for (;;) {
        if (lexer->eof(lexer)) {
            lexer->mark_end(lexer);
            lexer->result_symbol = COMMENT;
            return true;
        }
        if (lexer->lookahead == '*') {
            advance(lexer);
            if (lexer->lookahead == '/') {
                advance(lexer);
                lexer->mark_end(lexer);
                lexer->result_symbol = COMMENT;
                return true;
            }
            continue;
        }
        advance(lexer);
    }
}

// A `#` at the start of a line is a preprocessor line. The compiler skips it,
// including a backslash-newline continuation. Any other `#` is one ignored
// character, the same as an unexpected character in the lexer.
static bool scan_hash(TSLexer *lexer, bool line_start) {
    advance(lexer);
    if (line_start) {
        for (;;) {
            if (lexer->eof(lexer)) {
                break;
            }
            if (lexer->lookahead == '\\') {
                advance(lexer);
                if (!lexer->eof(lexer) && lexer->lookahead == '\n') {
                    advance(lexer);
                }
                continue;
            }
            if (lexer->lookahead == '\n') {
                advance(lexer);
                break;
            }
            advance(lexer);
        }
    }
    lexer->mark_end(lexer);
    lexer->result_symbol = COMMENT;
    return true;
}

static void mark_number(TSLexer *lexer) {
    lexer->mark_end(lexer);
    lexer->result_symbol = FLOAT_TRAILING_DOT;
}

// Float digits. A `'` is consumed even when the next character is not a digit,
// matching Lexer::lex_float.
static void consume_float_digits(TSLexer *lexer, bool hex) {
    for (;;) {
        if (lexer->eof(lexer)) {
            return;
        }
        if (lexer->lookahead == '\'') {
            advance(lexer);
            continue;
        }
        const int value = hex ? hex_value(lexer->lookahead) : digit_of(lexer->lookahead, 10);
        if (value < 0) {
            return;
        }
        advance(lexer);
    }
}

static void consume_exponent(TSLexer *lexer) {
    advance(lexer);
    if (!lexer->eof(lexer) && (lexer->lookahead == '+' || lexer->lookahead == '-')) {
        advance(lexer);
    }
    consume_float_digits(lexer, false);
}

// The exponent marker and the one-character float suffix are already decided.
// `f` after a hex fraction is a hex digit and is consumed with the fraction.
static void finish_float_tail(TSLexer *lexer, bool hex) {
    if (hex) {
        if (!lexer->eof(lexer) && (lexer->lookahead == 'p' || lexer->lookahead == 'P')) {
            consume_exponent(lexer);
        }
    } else if (!lexer->eof(lexer) && (lexer->lookahead == 'e' || lexer->lookahead == 'E')) {
        consume_exponent(lexer);
    }
    if (!lexer->eof(lexer) && (lexer->lookahead == 'f' || lexer->lookahead == 'F')) {
        advance(lexer);
    }
    mark_number(lexer);
}

// Lookahead is the radix dot. `..` is not a float: the earlier mark stands,
// so both dots and any quotes looked past stay outside the token (`1''..`).
static void finish_from_dot(TSLexer *lexer, bool hex) {
    advance(lexer);
    if (lexer->lookahead == '.') {
        return;
    }
    consume_float_digits(lexer, hex);
    finish_float_tail(lexer, hex);
}

static void consume_ident(TSLexer *lexer) {
    if (lexer->eof(lexer) || !is_ident_start(lexer->lookahead)) {
        return;
    }
    while (!lexer->eof(lexer) && is_ident_continue(lexer->lookahead)) {
        advance(lexer);
    }
}

// Integer digits for `base`. A `'` stays only when the next digit fits.
// A trailing `'` is still part of the token. Stops at the first rejected
// character, which remains the lookahead.
static void consume_strict_digits(TSLexer *lexer, int base) {
    for (;;) {
        if (lexer->eof(lexer)) {
            return;
        }
        if (lexer->lookahead == '\'') {
            advance(lexer);
            if (digit_of(lexer->lookahead, base) < 0) {
                return;
            }
            continue;
        }
        if (digit_of(lexer->lookahead, base) < 0) {
            return;
        }
        advance(lexer);
    }
}

// Quotes and digits the strict loop left behind. If they lead to `.` (not
// `..`), `e`/`E`, or `p`/`P`, this is a float and those characters belong to
// it. `*moved` means this look-ahead consumed characters. A false result with
// `*moved` must not call mark_end again: `1''2` ends at the first `'`.
static bool opens_float(TSLexer *lexer, bool hex, bool *moved) {
    *moved = false;
    for (;;) {
        if (lexer->eof(lexer)) {
            return false;
        }
        if (lexer->lookahead == '\'') {
            advance(lexer);
            *moved = true;
            continue;
        }
        if (hex ? hex_value(lexer->lookahead) >= 0 : is_digit(lexer->lookahead)) {
            advance(lexer);
            *moved = true;
            continue;
        }
        if (lexer->lookahead == '.') {
            return true;
        }
        if (hex) {
            return lexer->lookahead == 'p' || lexer->lookahead == 'P';
        }
        return lexer->lookahead == 'e' || lexer->lookahead == 'E';
    }
}

static void finish_integer(TSLexer *lexer, int base) {
    if (base == 2 || base == 8 || base == 16) {
        const int extra = base == 16 ? hex_value(lexer->lookahead)
                                      : (is_digit(lexer->lookahead) ? (int)(lexer->lookahead - '0') : -1);
        if (extra >= base) {
            while (!lexer->eof(lexer) &&
                   (is_digit(lexer->lookahead) || lexer->lookahead == '\'' || hex_value(lexer->lookahead) >= 0)) {
                advance(lexer);
            }
        }
    }
    consume_ident(lexer);
    mark_number(lexer);
}

// After a strict integer prefix, either extend to a float or keep the integer.
// Characters skipped while deciding a float are not part of the integer.
static bool finish_number_or_float(TSLexer *lexer, int base, bool hex) {
    mark_number(lexer);
    bool moved = false;
    if (!opens_float(lexer, hex, &moved)) {
        if (!moved) {
            finish_integer(lexer, base);
        }
        return true;
    }
    if (lexer->lookahead == '.') {
        finish_from_dot(lexer, hex);
    } else {
        finish_float_tail(lexer, hex);
    }
    return true;
}

// True when this starts a number. The token end is marked. False rewinds,
// so `...` and a bare `.` stay operators and punctuation.
static bool scan_lexer_number(TSLexer *lexer) {
    if (lexer->lookahead == '.') {
        advance(lexer);
        if (!is_digit(lexer->lookahead)) {
            return false;
        }
        consume_float_digits(lexer, false);
        finish_float_tail(lexer, false);
        return true;
    }
    if (!is_digit(lexer->lookahead)) {
        return false;
    }

    const bool zero = lexer->lookahead == '0';
    advance(lexer);
    if (zero && !lexer->eof(lexer) && (lexer->lookahead == 'x' || lexer->lookahead == 'X')) {
        advance(lexer);
        consume_strict_digits(lexer, 16);
        return finish_number_or_float(lexer, 16, true);
    }
    if (zero && !lexer->eof(lexer) && (lexer->lookahead == 'b' || lexer->lookahead == 'B')) {
        advance(lexer);
        consume_strict_digits(lexer, 2);
        finish_integer(lexer, 2);
        return true;
    }

    consume_strict_digits(lexer, 10);
    return finish_number_or_float(lexer, zero ? 8 : 10, false);
}

void *tree_sitter_tlc_external_scanner_create(void) { return NULL; }

void tree_sitter_tlc_external_scanner_destroy(void *payload) { (void)payload; }

unsigned tree_sitter_tlc_external_scanner_serialize(void *payload, char *buffer) {
    (void)payload;
    (void)buffer;
    return 0;
}

void tree_sitter_tlc_external_scanner_deserialize(void *payload, const char *buffer, unsigned length) {
    (void)payload;
    (void)buffer;
    (void)length;
}

// The internal lexer skips whitespace before it matches the next token.
// This scanner is tried first, at the character before that whitespace, so it
// has to skip the same characters or it never sees a later comment or number.
static bool is_space(int32_t c) { return c == ' ' || c == '\n' || c == '\t' || c == '\r' || c == '\v' || c == '\f'; }

bool tree_sitter_tlc_external_scanner_scan(void *payload, TSLexer *lexer, const bool *valid_symbols) {
    (void)payload;
    bool line_start = lexer->get_column(lexer) == 0;
    while (is_space(lexer->lookahead)) {
        if (lexer->lookahead == '\n') {
            line_start = true;
        }
        lexer->advance(lexer, true);
    }
    if (valid_symbols[COMMENT] && lexer->lookahead == '#') {
        return scan_hash(lexer, line_start);
    }
    // The lexer drops `\` and emits no token. One comment character keeps the
    // following tokens aligned. A string escape is inside the string token.
    if (valid_symbols[COMMENT] && lexer->lookahead == '\\') {
        advance(lexer);
        lexer->mark_end(lexer);
        lexer->result_symbol = COMMENT;
        return true;
    }
    if (valid_symbols[COMMENT] && lexer->lookahead == '/') {
        return scan_comment(lexer);
    }
    if (valid_symbols[FLOAT_TRAILING_DOT] && (is_digit(lexer->lookahead) || lexer->lookahead == '.')) {
        return scan_lexer_number(lexer);
    }
    return false;
}
