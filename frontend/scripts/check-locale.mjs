import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src/app/locale.ts");
const source = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
let catalog;
let shortList;
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(source) === "EN") catalog = node.initializer;
  if (ts.isVariableDeclaration(node) && node.name.getText(source) === "exactShort") shortList = node.initializer;
  ts.forEachChild(node, visit);
}
visit(source);
if (!catalog || !ts.isObjectLiteralExpression(catalog) || !shortList || !ts.isNewExpression(shortList)) throw new Error("Locale catalog structure is invalid");
const keys = new Map();
const duplicates = [];
for (const property of catalog.properties) {
  if (!ts.isPropertyAssignment(property) || !ts.isStringLiteral(property.name) || !ts.isStringLiteral(property.initializer)) throw new Error("Locale entries must be static string pairs");
  const key = property.name.text;
  if (keys.has(key)) duplicates.push(key);
  keys.set(key, property.initializer.text);
}
const values = shortList.arguments[0];
if (!values || !ts.isArrayLiteralExpression(values)) throw new Error("Locale short list must be a static array");
const missing = values.elements.map((node) => ts.isStringLiteral(node) ? node.text : "").filter((key) => !key || !keys.has(key));
const empty = [...keys].filter(([, value]) => !value).map(([key]) => key);
console.log(JSON.stringify({ entries: keys.size, exactShort: values.elements.length, duplicates, missing, empty }, null, 2));
const ok = duplicates.length === 0 && missing.length === 0 && empty.length === 0;
console.log(ok ? "LOCALE-CATALOG-PASS" : "LOCALE-CATALOG-FAIL");
process.exit(ok ? 0 : 1);
