import type { JSONSchemaType } from "ajv";
import { encodeJson } from "./json.ts";
import { compileLocalSchema } from "./schema-validator.ts";

export interface Result<Value> {
  readonly schema: object | boolean;
  readonly validate: (value: unknown) => value is Value;
}

export function defineResult<Value>(
  schema: JSONSchemaType<Value>,
): Result<Value> {
  const frozenSchema = structuredClone(schema);

  const validator = compileLocalSchema<Value>(frozenSchema);

  return {
    schema: frozenSchema,
    validate(value: unknown): value is Value {
      try {
        encodeJson(value);

        return validator(value);
      } catch {
        return false;
      }
    },
  };
}
