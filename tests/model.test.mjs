import test from "node:test";
import assert from "node:assert/strict";

test("availability excludes no-data time", () => {
  const segments = [
    { status: "online", startedAt: 0, endedAt: 1000 },
    { status: "offline", startedAt: 1000, endedAt: 2000 },
    { status: "no_data", startedAt: 2000, endedAt: 5000 }
  ];
  const relevant = segments.filter((segment) => segment.status !== "no_data");
  const monitored = relevant.reduce(
    (total, segment) => total + segment.endedAt - segment.startedAt,
    0
  );
  const downtime = relevant
    .filter((segment) => segment.status === "offline")
    .reduce((total, segment) => total + segment.endedAt - segment.startedAt, 0);
  assert.equal(((monitored - downtime) / monitored) * 100, 50);
});
