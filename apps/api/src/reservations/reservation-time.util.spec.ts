import assert from "node:assert/strict";
import test from "node:test";
import { generateReservationSlots, isValidIsoDate } from "./reservation-time.util";

test("generates only slots that finish before closing", () => {
  assert.deepEqual(generateReservationSlots("09:00", "12:00", 30, 90), [
    { startTime: "09:00", endTime: "10:30" }, { startTime: "09:30", endTime: "11:00" },
    { startTime: "10:00", endTime: "11:30" }, { startTime: "10:30", endTime: "12:00" },
  ]);
});

test("validates real ISO calendar dates", () => {
  assert.equal(isValidIsoDate("2028-02-29"), true);
  assert.equal(isValidIsoDate("2027-02-29"), false);
});
