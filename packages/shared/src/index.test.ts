import assert from "node:assert/strict";
import test from "node:test";

import { ListConfigsQuerySchema } from "./index.js";

test("ListConfigsQuerySchema applies default pagination", () => {
  const parsed = ListConfigsQuerySchema.parse({});

  assert.deepEqual(parsed, {
    query: "",
    page: 1,
    pageSize: 20,
  });
});

test("ListConfigsQuerySchema trims query text", () => {
  const parsed = ListConfigsQuerySchema.parse({
    query: "  demo-config  ",
    page: "2",
    pageSize: "10",
  });

  assert.deepEqual(parsed, {
    query: "demo-config",
    page: 2,
    pageSize: 10,
  });
});

test("ListConfigsQuerySchema rejects invalid page values", () => {
  const result = ListConfigsQuerySchema.safeParse({
    page: "0",
    pageSize: "20",
  });

  assert.equal(result.success, false);
});

test("ListConfigsQuerySchema rejects invalid pageSize values", () => {
  const result = ListConfigsQuerySchema.safeParse({
    page: "1",
    pageSize: "101",
  });

  assert.equal(result.success, false);
});
