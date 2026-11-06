import type { ValidateFunction } from "ajv";
import {
  type EventMap,
  type EventMethod,
  eventDefinitions,
} from "./generated.ts";
import { encodeJson, isRecord } from "./json.ts";
import schema from "./schema.json" with { type: "json" };
import { createSchemaValidator } from "./schema-validator.ts";
import { validateSemantics } from "./semantics.ts";

export interface Envelope {
  jsonrpc: "2.0";
  method: string;
  params: Record<string, unknown>;
  id?: string;
}

export interface Response {
  jsonrpc: "2.0";
  id: string | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

const validator = createSchemaValidator();

validator.addSchema(schema);

const envelopeValidator = validator.compile<Envelope>({
  $ref: `${schema.$id}#/definitions/InvocationEnvelope`,
});

const responseValidator = validator.compile<Response>({
  oneOf: [
    { $ref: `${schema.$id}#/definitions/SuccessResponse` },
    { $ref: `${schema.$id}#/definitions/ErrorResponse` },
  ],
});

const parameters = new Map<EventMethod, ValidateFunction>();

for (const method of Object.keys(eventDefinitions)) {
  if (isEventMethod(method)) {
    parameters.set(
      method,
      validator.compile({ $ref: `${schema.$id}${eventDefinitions[method]}` }),
    );
  }
}

function jsonValue(value: unknown): boolean {
  try {
    encodeJson(value);

    return true;
  } catch {
    return false;
  }
}

function boundedId(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    (typeof value === "string" && Buffer.byteLength(value, "utf8") <= 128)
  );
}

export function isEnvelope(value: unknown): value is Envelope {
  return (
    jsonValue(value) &&
    isRecord(value) &&
    boundedId(value.id) &&
    envelopeValidator(value)
  );
}

export function isResponse(value: unknown): value is Response {
  return (
    jsonValue(value) &&
    isRecord(value) &&
    boundedId(value.id) &&
    responseValidator(value)
  );
}

export function isEventMethod(value: string): value is EventMethod {
  return Object.hasOwn(eventDefinitions, value);
}

export function validateParams<Method extends EventMethod>(
  method: Method,
  value: unknown,
): value is EventMap[Method] {
  const validate = parameters.get(method);

  return (
    jsonValue(value) &&
    validate?.(value) === true &&
    validateSemantics(method, value)
  );
}
