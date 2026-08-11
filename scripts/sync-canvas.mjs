#!/usr/bin/env node
/**
 * Embeds data/usage-events-*.csv into the canvas CSV_CATALOG, then copies
 * canvases/cursor-usage-overview.canvas.tsx to Cursor's managed canvases dir
 * so the IDE can compile and display it beside chat.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA_DIR = path.join(ROOT, "data");
const CANVAS_NAME = "cursor-usage-overview.canvas.tsx";
const CANVAS_SRC = path.join(ROOT, "canvases", CANVAS_NAME);
const CANVAS_DEST = path.join(
  process.env.USERPROFILE ?? process.env.HOME ?? "",
  ".cursor",
  "projects",
  "c-Users-Maahi-Projects-Agentic-Projects-Cursor-Usage-Visualization",
  "canvases",
  CANVAS_NAME,
);

const CSV_PATTERN = /^usage-events-.*\.csv$/i;
const CATALOG_RE =
  /const CSV_CATALOG: \{ filename: string; text: string \}\[\] = \[[\s\S]*?\];/;

function main() {
  if (!fs.existsSync(DATA_DIR)) {
    console.error(`Missing data directory: ${DATA_DIR}`);
    process.exit(1);
  }
  if (!fs.existsSync(CANVAS_SRC)) {
    console.error(`Missing canvas source: ${CANVAS_SRC}`);
    process.exit(1);
  }

  const csvFiles = fs
    .readdirSync(DATA_DIR)
    .filter((name) => CSV_PATTERN.test(name))
    .sort((a, b) => b.localeCompare(a));

  if (csvFiles.length === 0) {
    console.error(`No usage-events-*.csv files found in ${DATA_DIR}`);
    process.exit(1);
  }

  const catalog = csvFiles.map((filename) => ({
    filename,
    text: fs.readFileSync(path.join(DATA_DIR, filename), "utf8"),
  }));

  let canvas = fs.readFileSync(CANVAS_SRC, "utf8");
  const replacement = `const CSV_CATALOG: { filename: string; text: string }[] = ${JSON.stringify(catalog)};`;

  if (!CATALOG_RE.test(canvas)) {
    console.error("Could not find CSV_CATALOG in canvas source.");
    process.exit(1);
  }

  canvas = canvas.replace(CATALOG_RE, replacement);
  fs.writeFileSync(CANVAS_SRC, canvas, "utf8");

  fs.mkdirSync(path.dirname(CANVAS_DEST), { recursive: true });
  fs.copyFileSync(CANVAS_SRC, CANVAS_DEST);

  console.log(`Embedded ${csvFiles.length} CSV file(s):`);
  for (const f of csvFiles) console.log(`  - ${f}`);
  console.log(`Updated: ${CANVAS_SRC}`);
  console.log(`Synced:  ${CANVAS_DEST}`);
  if (csvFiles.some((f) => f !== "usage-events-sample.csv")) {
    console.log(
      "Note: personal CSVs are embedded in the canvas. Do not commit that file if the repo is public.",
    );
  }
}

main();
