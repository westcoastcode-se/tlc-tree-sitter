// Token grammar for TLC.
// The words and the literal shapes match the compiler lexer
// (tlc-lang/src/lexer.cpp) and the token section of docs/grammar.md.
// It is not a statement parser. It keeps `func` and `type` names as nodes
// so an editor can list them and can run `main`.

const BUILTIN_TYPES = [
  "bool",
  "void",
  "i8",
  "u8",
  "i16",
  "u16",
  "i32",
  "u32",
  "i64",
  "u64",
  "f32",
  "f64",
];

// `bool` and `void` are keywords in the lexer and built-in types in the editor.
// `func` and `type` are handled below, because a following name is a declaration.
const KEYWORDS = [
  "_Alignas",
  "_Alignof",
  "_Atomic",
  "_BitInt",
  "_Bool",
  "_Complex",
  "_Decimal128",
  "_Decimal32",
  "_Decimal64",
  "_Generic",
  "_Imaginary",
  "_Noreturn",
  "_Static_assert",
  "_Thread_local",
  "alignas",
  "alignof",
  "assert",
  "auto",
  "break",
  "case",
  "const",
  "constexpr",
  "continue",
  "default",
  "defer",
  "do",
  "else",
  "enum",
  "export",
  "extern",
  "false",
  "for",
  "goto",
  "if",
  "import",
  "inline",
  "null",
  "package",
  "register",
  "restrict",
  "return",
  "sizeof",
  "static_assert",
  "struct",
  "switch",
  "test",
  "thread_local",
  "trait",
  "true",
  "typeof",
  "typeof_unqual",
  "union",
  "var",
  "volatile",
  "while",
];

// A `'` between digits is a separator. The piece after it must be a digit.
const DEC = /[0-9]([0-9]|'[0-9])*/;
const HEX = /[0-9a-fA-F]([0-9a-fA-F]|'[0-9a-fA-F])*/;
const INT_SUFFIX = /(i8|i16|i32|i64|u8|u16|u32|u64)/;
const EXP = /[eE][+-]?[0-9]([0-9]|'[0-9])*/;
const BIN_EXP = /[pP][+-]?[0-9]([0-9]|'[0-9])*/;
const FLOAT_SUFFIX = /[fF]/;

const ESCAPE = choice(
  /\\x[0-9a-fA-F]+/,
  /\\[0-7]{1,3}/,
  /\\./,
);

module.exports = grammar({
  name: "tlc",

  extras: ($) => [/\s/, $.comment],

  word: ($) => $.identifier,

  rules: {
    source_file: ($) => repeat($._token),

    _token: ($) =>
      choice(
        $.function_definition,
        $.type_definition,
        $.string,
        $.character,
        $.number,
        $.builtin_type,
        $.keyword,
        $.identifier,
        $.operator,
        $.punctuation,
      ),

    // `func name` and `func Type::name`.
    // `func Type[T]::name` stays a plain `func Type`; the brackets are tokens.
    // A bracket list can contain the keyword `type` (`func id[T type]`), and
    // folding that list into this rule makes `type` fail to lex.
    // `func (` is a function type, so `func` is then only a keyword.
    function_definition: ($) =>
      choice(
        prec(2, seq("func", field("type", $.identifier), "::", field("name", $.identifier))),
        prec(1, seq("func", field("name", $.identifier))),
        prec(0, alias("func", $.keyword)),
      ),

    // `type Name`. A bare `type`, as in `T type`, is a keyword.
    type_definition: ($) =>
      choice(
        prec(1, seq("type", field("name", $.identifier))),
        prec(0, alias("type", $.keyword)),
      ),

    comment: ($) =>
      token(
        choice(
          seq("//", /.*/),
          seq("/*", /[^*]*\*+([^/*][^*]*\*+)*/, "/"),
        ),
      ),

    string: ($) =>
      token(
        choice(
          seq('"', repeat(choice(/[^"\\\n]/, ESCAPE)), '"'),
          seq("`", repeat(/[^`]/), "`"),
        ),
      ),

    character: ($) => token(seq("'", choice(/[^'\\\n]/, ESCAPE), "'")),

    // Longer literals are listed first. The lexer still picks the longest match.
    number: ($) =>
      token(
        choice(
          seq(/0[xX]/, HEX, ".", HEX, BIN_EXP, optional(FLOAT_SUFFIX)),
          seq(/0[xX]/, HEX, BIN_EXP, optional(FLOAT_SUFFIX)),
          seq(/0[xX]/, ".", HEX, BIN_EXP, optional(FLOAT_SUFFIX)),
          seq(DEC, ".", DEC, optional(EXP), optional(FLOAT_SUFFIX)),
          seq(DEC, ".", EXP, optional(FLOAT_SUFFIX)),
          seq(DEC, EXP, optional(FLOAT_SUFFIX)),
          seq(".", DEC, optional(EXP), optional(FLOAT_SUFFIX)),
          seq(/0[bB][01]([01]|'[01])*/, optional(INT_SUFFIX)),
          seq(/0[xX]/, HEX, optional(INT_SUFFIX)),
          seq(/0[0-7]([0-7]|'[0-7])*/, optional(INT_SUFFIX)),
          seq(DEC, optional(INT_SUFFIX)),
        ),
      ),

    builtin_type: ($) => choice(...BUILTIN_TYPES),

    keyword: ($) => choice(...KEYWORDS),

    identifier: ($) => /[A-Za-z_][A-Za-z0-9_]*/,

    operator: ($) =>
      choice(
        "...",
        "::",
        "<<=",
        ">>=",
        ":=",
        "==",
        "!=",
        "<=",
        ">=",
        "&&",
        "||",
        "<<",
        ">>",
        "->",
        "++",
        "--",
        "+=",
        "-=",
        "*=",
        "/=",
        "%=",
        "&=",
        "|=",
        "^=",
        "+",
        "-",
        "*",
        "/",
        "%",
        "=",
        "<",
        ">",
        "!",
        "&",
        "|",
        "^",
        "~",
        "?",
      ),

    punctuation: ($) => choice("(", ")", "{", "}", "[", "]", ",", ";", ".", ":"),
  },
});
