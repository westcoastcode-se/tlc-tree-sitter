# tree-sitter grammar for TLC

This grammar tokenizes TLC the way the compiler lexer does. It is the grammar Zed uses for highlighting, brackets, and the run button on `func main`. It is not a statement parser. Names, types, and diagnostics come from `tlc lsp`.

The words and the literal shapes follow `tlc-lang/src/lexer.cpp` and the token section of `tlc-lang/docs/grammar.md`.

## Layout

A `func` or `type` followed by a name is a node, so an editor can list it.

- `func main` keeps the name `main`.
- `func Point::sum` keeps the type `Point` and the name `sum`.
- `func Box[T]::from` keeps the name `Box`. The bracket list is ordinary tokens, because that list can contain the keyword `type` (`func id[T type]`).
- `func (` is a function type. `func` is only a keyword there.
- `T type` is the keyword `type`, not a type declaration.

## Check

From this directory, with the compiler checkout next to it:

```sh
npm install
npm test
```

`npm test` parses `test/shapes.tlc` and every `.tlc` file under `../tlc-lang`. A file with an error node fails the test.

After a change to `grammar.js`, regenerate the C parser with the same tree-sitter version the compiler repo last used:

```sh
npx tree-sitter-cli@0.25.8 generate
```

## Limits

`1.`, `1.f`, and `0x1.p1` are one number. `1.5` and `.5` are one number. A digit separator such as `1'000` is one number. `0...` is a number and `...`: the dot is not part of the float when another dot follows. A literal the compiler keeps as one token and then rejects, such as `1e`, `0x`, `0b12`, or `1u32x`, is still one number. A `#` line and a `\` are skipped, matching the lexer. `''` is one character. `'ab'` is a character, an identifier, and a character. An unclosed quoted string stops before the newline. An unclosed raw string runs to the end of the file.
