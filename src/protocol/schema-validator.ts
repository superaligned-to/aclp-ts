import { Ajv, type Schema, type ValidateFunction } from "ajv";
import { fullFormats } from "ajv-formats/dist/formats.js";
import { encodeJson, isRecord } from "./json.ts";

// Count schema containers and scalar values, including annotation data; exclude object keys.
export const MAX_SCHEMA_NODES = 2_048;

export const MAX_SCHEMA_DEPTH = 32;

function checkComplexity(schema: unknown): void {
  let nodes = 0;

  function visit(value: unknown, depth: number): void {
    nodes++;

    if (nodes > MAX_SCHEMA_NODES || depth > MAX_SCHEMA_DEPTH) {
      throw new Error("JSON schema complexity limit exceeded");
    }

    if (Array.isArray(value)) {
      for (const child of value) {
        visit(child, depth + 1);
      }
    } else if (isRecord(value)) {
      for (const child of Object.values(value)) {
        visit(child, depth + 1);
      }
    }
  }

  visit(schema, 0);
}

export function createSchemaValidator(): Ajv {
  const validator = new Ajv({
    strict: false,
    allErrors: false,
    validateFormats: true,
    coerceTypes: false,
    useDefaults: false,
    removeAdditional: false,
    ownProperties: true,
    loopRequired: 32,
    loopEnum: 32,
  });

  for (const [name, format] of Object.entries(fullFormats)) {
    validator.addFormat(name, format);
  }

  const meta: unknown = validator.getSchema(
    "http://json-schema.org/draft-07/schema",
  )?.schema;

  if (isRecord(meta)) {
    validator.addMetaSchema(meta, "https://json-schema.org/draft-07/schema");
  }

  return validator;
}

export function compileLocalSchema<T>(schema: Schema): ValidateFunction<T> {
  encodeJson(schema);
  checkComplexity(schema);

  const validator = createSchemaValidator().compile<T>(schema);

  if ("$async" in validator && validator.$async === true) {
    throw new Error("Asynchronous JSON schemas are not supported");
  }

  return validator;
}
