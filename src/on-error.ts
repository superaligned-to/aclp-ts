import type { EventMethod } from "./protocol/index.ts";

/**
 * What a harness does when a guarded request fails: `deny` keeps the pending
 * continuation blocked, `allow` lets it proceed without that server's effects.
 */
export type OnError = "allow" | "deny";

/** Methods whose reply can stop an action; a failure there denies by default. */
export const FAIL_CLOSED_METHODS: readonly EventMethod[] = [
  "tool.requested",
  "permission.requested",
];

export function isOnError(value: unknown): value is OnError {
  return value === "allow" || value === "deny";
}

/** The effective policy for `method`: the configured one, else the method's default. */
export function onErrorFor(method: string, configured?: OnError): OnError {
  if (configured !== undefined) {
    return configured;
  }

  return (FAIL_CLOSED_METHODS as readonly string[]).includes(method)
    ? "deny"
    : "allow";
}
