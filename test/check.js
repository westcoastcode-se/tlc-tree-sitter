const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const cli = path.join(root, "node_modules", ".bin", "tree-sitter");

function run(args) {
  // The CLI colors the CST whenever NO_COLOR is unset, even on a pipe.
  // The checks below match the plain text.
  const env = { ...process.env, NO_COLOR: "1" };
  return spawnSync(cli, args, { encoding: "utf8", cwd: root, env });
}

function parse(file) {
  const result = run(["parse", file]);
  const out = `${result.stdout || ""}\n${result.stderr || ""}`;
  if (result.status !== 0 || out.includes("(ERROR") || out.includes("(MISSING")) {
    return out;
  }
  return null;
}

function cst(file) {
  return run(["parse", file, "--cst"]).stdout || "";
}

function walk(dir, files) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === ".git" || entry.name === "build" || entry.name === "node_modules") {
      continue;
    }
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, files);
    } else if (entry.name.endsWith(".tlc")) {
      files.push(full);
    }
  }
}

let failed = 0;
const shapes = path.join(root, "test", "shapes.tlc");
const shapesError = parse(shapes);
if (shapesError) {
  console.error(shapesError);
  failed += 1;
}

const query = run(["query", path.join(root, "test", "names.scm"), shapes]);
if (query.status !== 0) {
  console.error(query.stderr || query.stdout);
  failed += 1;
}
const names = query.stdout || "";
for (const text of ["main", "sum", "from", "width", "id", "Point", "Box"]) {
  if (!names.includes("text: `" + text + "`")) {
    console.error("missing capture: " + text);
    failed += 1;
  }
}

const shapeTree = cst(shapes);
for (const text of ["1.", "1.f", "10.F", "1'000.", "0x1.p1", "0xAB.p-2f", "0x1.P1"]) {
  if (!shapeTree.includes("number `" + text + "`")) {
    console.error("missing number: " + text);
    failed += 1;
  }
}
if (shapeTree.includes("number `0.`") || shapeTree.includes("number `0...`")) {
  console.error("ellipsis was absorbed into a float");
  failed += 1;
}
if (!shapeTree.includes('"..."')) {
  console.error("missing ellipsis");
  failed += 1;
}
if (!shapeTree.includes("comment `// comment`") || !shapeTree.includes("comment `/* block */`")) {
  console.error("comment was not a comment");
  failed += 1;
}

const literals = path.join(root, "test", "literals.tlc");
const literalsError = parse(literals);
if (literalsError) {
  console.error(literalsError);
  failed += 1;
}
const literalTree = cst(literals);
for (const text of [
  "1e",
  "1e+",
  "1.e",
  "1.e+",
  "0e1",
  "0x1.",
  "0x1.f",
  "0x.p1",
  "0x",
  "0x1ep1",
  "0b",
  "0b12",
  "0b1",
  "1u32x",
  "1u",
  "1'.5",
  "1''e5",
  "0x1''2p1",
  "1.f",
  "08",
]) {
  if (!literalTree.includes("number `" + text + "`")) {
    console.error("missing number: " + text);
    failed += 1;
  }
}
if (literalTree.includes("identifier `include`") || literalTree.includes("identifier `define`")) {
  console.error("preprocessor line was tokenized");
  failed += 1;
}
if (!literalTree.includes("number `2`") || !literalTree.includes("identifier `u0041`")) {
  console.error("skipped trivia swallowed the next token");
  console.error(literalTree);
  failed += 1;
}
if (literalTree.includes("number `1`\n") && literalTree.includes("comment `#define")) {
  const defineAt = literalTree.indexOf("comment `#define");
  const keptAt = literalTree.indexOf("identifier `kept`");
  const between = literalTree.slice(defineAt, keptAt);
  if (between.includes("number `1`")) {
    console.error("directive continuation was tokenized");
    failed += 1;
  }
}

const chars = path.join(root, "test", "chars.tlc");
const charsError = parse(chars);
if (charsError) {
  console.error(charsError);
  failed += 1;
}
const charTree = cst(chars);
if (!charTree.includes("character `''`") || !charTree.includes("character `'a`")) {
  console.error("character literal was split");
  console.error(charTree);
  failed += 1;
}
if (charTree.includes("character `'ab'`") || !charTree.includes("identifier `b`")) {
  console.error("'ab' was kept as one character");
  console.error(charTree);
  failed += 1;
}

const rawOpen = path.join(root, "test", "raw_open.tlc");
const rawOpenError = parse(rawOpen);
if (rawOpenError) {
  console.error(rawOpenError);
  failed += 1;
}
const rawOpenTree = cst(rawOpen);
if (!rawOpenTree.includes("``still") || rawOpenTree.includes("number `2`") || !rawOpenTree.includes("number `1`")) {
  console.error("unterminated raw string was not one string");
  console.error(rawOpenTree);
  failed += 1;
}

const strOpen = path.join(root, "test", "str_open.tlc");
const strOpenError = parse(strOpen);
if (strOpenError) {
  console.error(strOpenError);
  failed += 1;
}
const strOpenTree = cst(strOpen);
if (!strOpenTree.includes("string `\"unterminated`") || !strOpenTree.includes("number `2`") || !strOpenTree.includes("number `3`")) {
  console.error("unterminated quoted string did not stop before the newline");
  console.error(strOpenTree);
  failed += 1;
}
if (!strOpenTree.includes("string `\"foo\\")) {
  console.error("truncated string escape dropped the backslash");
  console.error(strOpenTree);
  failed += 1;
}

const seps = path.join(root, "test", "seps.tlc");
const sepsError = parse(seps);
if (sepsError) {
  console.error(sepsError);
  failed += 1;
}
const sepTree = cst(seps);
for (const text of ["1'", "0x1'"]) {
  if (!sepTree.includes("number `" + text + "`")) {
    console.error("missing number: " + text);
    failed += 1;
  }
}
if (sepTree.includes("number `1''2`") || sepTree.includes("number `0x1''2`") || sepTree.includes("number `1''")) {
  console.error("digit separator look-ahead was kept in the number");
  console.error(sepTree);
  failed += 1;
}

const unclosed = path.join(root, "test", "unclosed.tlc");
const unclosedError = parse(unclosed);
if (unclosedError) {
  console.error(unclosedError);
  failed += 1;
}
const unclosedTree = cst(unclosed);
if (!unclosedTree.includes("`/* still") || unclosedTree.includes("number `2`")) {
  console.error("unterminated block comment was not consumed");
  console.error(unclosedTree);
  failed += 1;
}

const compiler = path.resolve(root, "..", "tlc-lang");
if (fs.existsSync(compiler)) {
  const files = [];
  walk(compiler, files);
  files.sort();
  for (const file of files) {
    const error = parse(file);
    if (error) {
      console.error(file);
      const line = error.split("\n").find((item) => item.includes("ERROR") || item.includes("MISSING"));
      if (line) {
        console.error(line);
      }
      failed += 1;
    }
  }
  console.log("parsed " + files.length + " compiler files");
} else {
  console.log("compiler tree not found, skipped");
}

if (failed !== 0) {
  console.error(failed + " check(s) failed");
  process.exit(1);
}
console.log("ok");
