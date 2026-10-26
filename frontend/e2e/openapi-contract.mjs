import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { load } from "js-yaml";
import Ajv from "ajv";
import addFormats from "ajv-formats";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const document = load(fs.readFileSync(path.join(repoRoot, "backend/contracts/openapi.yaml"), "utf8"));
const ajv = new Ajv({ strict: "log", allErrors: true });
addFormats(ajv);
ajv.addFormat("int64", { type: "number", validate: (value) => Number.isSafeInteger(value) });
export { document as openapiDocument };

export function schemaValidator(schemaName) {
  const schema = document.components.schemas[schemaName];
  if (!schema) throw new Error(`Unknown OpenAPI schema: ${schemaName}`);
  return ajv.compile(referencesToDefs({ ...schema, $defs: document.components.schemas }));
}

export function envelopeSchema(schemaName, itemSchema) {
  return referencesToDefs({
    type: "object",
    required: ["data"],
    properties: { data: { type: "array", items: itemSchema }, meta: { $ref: "#/components/schemas/ResponseMeta" } },
    $defs: document.components.schemas,
  });
}

function referencesToDefs(value) {
  if (Array.isArray(value)) return value.map(referencesToDefs);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [
    key,
    key === "$ref" && typeof entry === "string" ? entry.replace(/^#\/components\/schemas\//, "#/$defs/") : referencesToDefs(entry),
  ]));
}

export function listEnvelopeValidator(itemSchemaName) {
  return ajv.compile(envelopeSchema("List", { $ref: `#/components/schemas/${itemSchemaName}` }));
}

export function schemaErrors(validate, body, limit = 3) {
  return (validate.errors ?? []).slice(0, limit).map((error) => `${error.instancePath || "/"} ${error.message}`);
}
