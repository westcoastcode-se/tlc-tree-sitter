const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const cli = path.join(root, "node_modules", ".bin", "tree-sitter");

function run(args) {
  return spawnSync(cli, args, { encoding: "utf8", cwd: root });
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
