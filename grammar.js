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
  "delete",
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
  "new",
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
  "unsafe",
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

// A backslash and the character it escapes. Hex and octal escapes are longer
// than one character, so the lexer keeps every hex digit and up to three
// octal digits. A `\` at end of file, or right before a newline, stays in the
// literal. That newline is not the escaped character.
const ESCAPE = choice(
  /\\x[0-9a-fA-F]+/,
  /\\[0-7]{1,3}/,
  /\\[^\n]/,
  /\\/,
);

module.exports = grammar({
  name: "tlc",

  extras: ($) => [/\s/, $.comment],

  // `//` and `/*` are one external token. An internal `/*` pattern cannot
  // stop at the first `*/` and also reach the end of the file when `*/` is
  // missing. The trailing-dot float is separate so `0...` stays a number
  // and an ellipsis.
  externals: ($) => [$.comment, $._float_trailing_dot],

  word: ($) => $.identifier,

  // `func Type[T]::name` and `func name` share a prefix. Both parses stay so
  // `func name[T type]` still treats `type` as a keyword.
  conflicts: ($) => [[$.function_definition]],

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

    // `func name`, `func Type::name`, and `func Type[T]::name`.
    // Brackets before `::` stay in this rule so the name is the method, not the type.
    // `func name[T type]` has the same prefix and no `::` after the brackets.
    // Both stay, at the same precedence, so `type` is still a keyword there.
    // Dynamic precedence keeps the method name when `::` is present.
    // The brackets are not one token. `func (` is a function type, so `func`
    // is then only a keyword.
    function_definition: ($) =>
      choice(
        prec.dynamic(
          1,
          prec(
            1,
            seq(
              "func",
              field("type", $.identifier),
              "[",
              repeat($._type_parameter),
              "]",
              "::",
              field("name", $.identifier),
            ),
          ),
        ),
        prec(2, seq("func", field("type", $.identifier), "::", field("name", $.identifier))),
        prec(1, seq("func", field("name", $.identifier))),
        prec(0, alias("func", $.keyword)),
      ),

    // A type-parameter list on a method: `Vec[T]`, `Buf[N, T]`, `Box[T type]`.
    _type_parameter: ($) =>
      choice(
        $.identifier,
        $.number,
        $.builtin_type,
        $.keyword,
        alias("type", $.keyword),
        $.operator,
        ",",
        seq("[", repeat($._type_parameter), "]"),
      ),

    // `type Name`. A bare `type`, as in `T type`, is a keyword.
    type_definition: ($) =>
      choice(
        prec(1, seq("type", field("name", $.identifier))),
        prec(0, alias("type", $.keyword)),
      ),

    // A missing closer does not split the literal. A quoted string stops before
    // a newline. A raw string runs to the end of the file. The closed form is
    // longer, so a present closer stays inside the token.
    string: ($) =>
      token(
        choice(
          seq('"', repeat(choice(/[^"\\\n]/, ESCAPE)), '"'),
          seq('"', repeat(choice(/[^"\\\n]/, ESCAPE))),
          seq("`", repeat(/[^`]/), "`"),
          seq("`", repeat(/[^`]/)),
        ),
      ),

    // `''` is one character. `'ab'` is `'a`, then `b`, then `'`. An unclosed
    // constant is still one character token, including a truncated escape.
    character: ($) =>
      token(
        choice(
          seq("'", choice(ESCAPE, /[^'\\\n]/), "'"),
          seq("'", choice(ESCAPE, /[^'\\\n]/)),
          "''",
          "'",
        ),
      ),

    // Longer literals are listed first. The lexer still picks the longest match.
    // `1.` is external: a regex cannot see that the next character is not `.`.
    number: ($) =>
      choice(
        $._float_trailing_dot,
        token(
          choice(
            seq(/0[xX]/, HEX, ".", HEX, BIN_EXP, optional(FLOAT_SUFFIX)),
            seq(/0[xX]/, HEX, ".", BIN_EXP, optional(FLOAT_SUFFIX)),
            seq(/0[xX]/, HEX, BIN_EXP, optional(FLOAT_SUFFIX)),
            seq(/0[xX]/, ".", HEX, BIN_EXP, optional(FLOAT_SUFFIX)),
            seq(DEC, ".", DEC, optional(EXP), optional(FLOAT_SUFFIX)),
            seq(DEC, ".", EXP, optional(FLOAT_SUFFIX)),
            seq(DEC, ".", FLOAT_SUFFIX),
            seq(DEC, EXP, optional(FLOAT_SUFFIX)),
            seq(".", DEC, optional(EXP), optional(FLOAT_SUFFIX)),
            seq(/0[bB][01]([01]|'[01])*/, optional(INT_SUFFIX)),
            seq(/0[xX]/, HEX, optional(INT_SUFFIX)),
            seq(/0[0-7]([0-7]|'[0-7])*/, optional(INT_SUFFIX)),
            seq(DEC, optional(INT_SUFFIX)),
          ),
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
