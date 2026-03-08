import assert from "node:assert/strict";
import test from "node:test";

import { ConfigChangeEventSchema, ListConfigsQuerySchema, SubscribeConfigsQuerySchema } from "./index.js";

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

test("SubscribeConfigsQuerySchema parses repeated keys", () => {
  const parsed = SubscribeConfigsQuerySchema.parse({
    key: ["  feature.a ", "feature.b"],
  });

  assert.deepEqual(parsed, {
    key: ["feature.a", "feature.b"],
  });
});

test("ConfigChangeEventSchema accepts upsert and delete events", () => {
  const upsert = ConfigChangeEventSchema.parse({
    type: "upsert",
    key: "feature.a",
    value: "enabled",
    changedAt: "2026-03-09T10:00:00.000Z",
  });
  const deleted = ConfigChangeEventSchema.parse({
    type: "delete",
    key: "feature.a",
    changedAt: "2026-03-09T11:00:00.000Z",
  });

  assert.deepEqual(upsert, {
    type: "upsert",
    key: "feature.a",
    value: "enabled",
    changedAt: "2026-03-09T10:00:00.000Z",
  });
  assert.deepEqual(deleted, {
    type: "delete",
    key: "feature.a",
    changedAt: "2026-03-09T11:00:00.000Z",
  });
});
