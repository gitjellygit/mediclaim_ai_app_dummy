import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { captureAsyncRouter } from "../src/middleware/asyncRouter.js";

test("B3 - rejected async handlers forward errors once to Express error middleware", async () => {
  const router = express.Router();
  const expected = new Error("synthetic rejected promise");
  router.get("/async-failure", async () => { throw expected; });

  captureAsyncRouter(router);
  const routeHandler = router.stack[0].route.stack[0].handle;
  let calls = 0;
  await new Promise((resolve, reject) => {
    routeHandler({}, {}, (error) => {
      calls += 1;
      if (error !== expected) return reject(new Error("Unexpected forwarded error"));
      resolve();
    });
  });
  assert.equal(calls, 1);
});

test("B3 - synchronous throws are forwarded and repeated wrapping is idempotent", () => {
  const router = express.Router();
  const expected = new Error("synthetic synchronous error");
  router.post("/sync-failure", () => { throw expected; });

  captureAsyncRouter(router);
  const wrapper = router.stack[0].route.stack[0].handle;
  captureAsyncRouter(router);
  assert.equal(router.stack[0].route.stack[0].handle, wrapper);

  let received = null;
  wrapper({}, {}, (error) => { received = error; });
  assert.equal(received, expected);
});
