import assert from "node:assert/strict";
import test from "node:test";
import { isOnError, onErrorFor } from "./on-error.ts";

test("a failure denies only tool and permission guards by default", () => {
  assert.equal(onErrorFor("tool.requested"), "deny");
  assert.equal(onErrorFor("permission.requested"), "deny");
  assert.equal(onErrorFor("input.submitted"), "allow");
  assert.equal(onErrorFor("model.requested"), "allow");
  assert.equal(onErrorFor("client.registered"), "allow");
});

test("a configured policy applies to every method", () => {
  assert.equal(onErrorFor("tool.requested", "allow"), "allow");
  assert.equal(onErrorFor("input.submitted", "deny"), "deny");
  assert.equal(isOnError("allow"), true);
  assert.equal(isOnError("open"), false);
});
