import assert from "node:assert/strict";
import { parseProjectSelection, resolveProjectSelection } from "../src/renderer/stores/project-selection";

const projects = [
  { id: "project-a", storeProducts: [{ id: "a-ios" }, { id: "a-macos" }] },
  { id: "project-b", storeProducts: [{ id: "b-ios" }] },
];

assert.deepEqual(parseProjectSelection('{"projectId":"project-a","productId":"a-macos"}'), {
  projectId: "project-a",
  productId: "a-macos",
});
assert.equal(parseProjectSelection("not-json"), null);

assert.deepEqual(
  resolveProjectSelection(projects, { projectId: null, productId: null }, { projectId: "project-a", productId: "a-macos" }),
  { projectId: "project-a", productId: "a-macos" },
  "reload restores the persisted project and product pair",
);
assert.deepEqual(
  resolveProjectSelection(projects, { projectId: "project-b", productId: "b-ios" }, { projectId: "project-a", productId: "a-macos" }),
  { projectId: "project-b", productId: "b-ios" },
  "an active in-memory selection wins during background data refresh",
);
assert.deepEqual(
  resolveProjectSelection(projects, { projectId: null, productId: null }, { projectId: "deleted", productId: "missing" }),
  { projectId: "project-a", productId: "a-ios" },
  "deleted persisted IDs fall back to the first real project and product",
);
assert.deepEqual(
  resolveProjectSelection(projects, { projectId: null, productId: null }, { projectId: "project-a", productId: "b-ios" }),
  { projectId: "project-a", productId: "a-ios" },
  "a product from another project is never restored into the selected project",
);

console.log("project selection persistence tests passed ✓");
