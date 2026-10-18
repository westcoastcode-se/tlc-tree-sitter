#include "tree_sitter/parser.h"

#include <stdbool.h>

// External tokens, in the same order as `externals` in grammar.js.
enum TokenType {
    COMMENT,
    FLOAT_TRAILING_DOT,
};

static void advance(TSLexer *lexer) { lexer->advance(lexer, false); }

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

// A decimal float with a dot and no digits after it: `1.` and `1'000.`.
// The lexer only does this when the next character is not another dot, so
// `0...` stays the integer `0` and the operator `...`. Forms with digits, an
// exponent, or an `f` suffix are ordinary number tokens and are longer.
static bool scan_trailing_dot_float(TSLexer *lexer) {
    advance(lexer);
    for (;;) {
        if (lexer->lookahead >= '0' && lexer->lookahead <= '9') {
            advance(lexer);
            continue;
        }
        if (lexer->lookahead == '\'') {
            advance(lexer);
            if (lexer->lookahead < '0' || lexer->lookahead > '9') {
                return false;
            }
            advance(lexer);
            continue;
        }
        break;
    }
    if (lexer->lookahead != '.') {
        return false;
    }
    advance(lexer);
    const int32_t next = lexer->lookahead;
    if (next == '.' || (next >= '0' && next <= '9') || next == 'e' || next == 'E' || next == 'f' ||
        next == 'F') {
        return false;
    }
    lexer->mark_end(lexer);
    lexer->result_symbol = FLOAT_TRAILING_DOT;
    return true;
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
// has to skip the same characters or it never sees a later comment or `1.`.
static bool is_space(int32_t c) { return c == ' ' || (c >= '\t' && c <= '\r'); }

bool tree_sitter_tlc_external_scanner_scan(void *payload, TSLexer *lexer, const bool *valid_symbols) {
    (void)payload;
    while (is_space(lexer->lookahead)) {
        lexer->advance(lexer, true);
    }
    if (valid_symbols[COMMENT] && lexer->lookahead == '/') {
        return scan_comment(lexer);
    }
    if (valid_symbols[FLOAT_TRAILING_DOT] && lexer->lookahead >= '0' && lexer->lookahead <= '9') {
        return scan_trailing_dot_float(lexer);
    }
    return false;
}
