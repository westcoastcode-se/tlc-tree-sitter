const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const cli = path.join(root, "node_modules", ".bin", "tree-sitter");

function parse(file) {
  const result = spawnSync(cli, ["parse", file], { encoding: "utf8" });
  const out = `${result.stdout || ""}\n${result.stderr || ""}`;
  if (result.status !== 0 || out.includes("(ERROR") || out.includes("(MISSING")) {
    return out;
  }
  return null;
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

const query = spawnSync(cli, ["query", path.join(root, "test", "names.scm"), shapes], {
  encoding: "utf8",
});
if (query.status !== 0) {
  console.error(query.stderr || query.stdout);
  failed += 1;
}
const names = query.stdout || "";
for (const text of ["main", "sum", "id", "Point", "Box"]) {
  if (!names.includes("text: `" + text + "`")) {
    console.error("missing capture: " + text);
    failed += 1;
  }
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
