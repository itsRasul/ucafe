import assert from "node:assert/strict";
import test from "node:test";
import { PromotionRewardType as Reward } from "./entities";
import { priceWithPromotion, promotionStatus } from "./promotion-pricing.util";
import { promotionScheduleMatches, PromotionWeekday } from "./promotion-schedule.util";

const promotion = (id: string, rewardType: Reward, rewardValue: string, priority = 0) => ({ id, name: id, priority, rewardType, rewardValue });

test("promotion pricing covers percentage, fixed amount, floor, fixed price and rounding", () => {
  assert.equal(priceWithPromotion("100000", [promotion("p", Reward.Percentage, "20")]).finalPriceToman, "80000");
  assert.equal(priceWithPromotion("100000", [promotion("p", Reward.FixedAmount, "30000")]).finalPriceToman, "70000");
  assert.equal(priceWithPromotion("100000", [promotion("p", Reward.FixedAmount, "150000")]).finalPriceToman, "0");
  assert.equal(priceWithPromotion("100000", [promotion("p", Reward.FixedPrice, "75000")]).finalPriceToman, "75000");
  assert.equal(priceWithPromotion("1", [promotion("p", Reward.Percentage, "50")]).discountAmountToman, "1");
  assert.equal(priceWithPromotion("100", [promotion("p", Reward.FixedPrice, "200")]).discountAmountToman, "0");
});

test("promotion pricing chooses the largest discount, then priority, then stable id", () => {
  const result = priceWithPromotion("100000", [promotion("z", Reward.FixedAmount, "20000", 9), promotion("b", Reward.Percentage, "20", 1), promotion("a", Reward.FixedAmount, "20000", 9)]);
  assert.equal(result.promotion?.id, "a");
  assert.equal(result.discountAmountToman, "20000");
});

test("promotion status uses start-inclusive and end-exclusive UTC instants", () => {
  const now = new Date("2026-09-25T12:00:00.000Z");
  assert.equal(promotionStatus({ isActive: true, startAt: new Date(now), endAt: null }, now), "RUNNING");
  assert.equal(promotionStatus({ isActive: true, startAt: null, endAt: new Date(now) }, now), "EXPIRED");
  assert.equal(promotionStatus({ isActive: true, startAt: new Date(now.getTime() + 1), endAt: null }, now), "UPCOMING");
});

const window = (daysOfWeek: PromotionWeekday[], startTime: string | null, endTime: string | null, isAllDay = false) => ({ daysOfWeek, startTime, endTime, isAllDay });

test("weekly schedule includes its start, excludes its end, and combines windows without double application", () => {
  const single = [window(["FRIDAY"], "16:00", "19:00")];
  assert.equal(promotionScheduleMatches(single, new Date("2026-09-25T16:00:00.000Z"), "UTC"), true);
  assert.equal(promotionScheduleMatches(single, new Date("2026-09-25T19:00:00.000Z"), "UTC"), false);
  assert.equal(promotionScheduleMatches(single, new Date("2026-09-25T15:59:59.999Z"), "UTC"), false);
  const overlap = [...single, window(["FRIDAY"], "18:00", "21:00")];
  assert.equal(promotionScheduleMatches(overlap, new Date("2026-09-25T18:30:00.000Z"), "UTC"), true);
  assert.equal(promotionScheduleMatches(overlap, new Date("2026-09-25T21:00:00.000Z"), "UTC"), false);
});

test("separate weekly windows cover morning and afternoon only", () => {
  const monday = [window(["MONDAY"], "08:00", "11:00"), window(["MONDAY"], "16:00", "19:00")];
  assert.equal(promotionScheduleMatches(monday, new Date("2026-09-28T09:00:00.000Z"), "UTC"), true);
  assert.equal(promotionScheduleMatches(monday, new Date("2026-09-28T14:00:00.000Z"), "UTC"), false);
  assert.equal(promotionScheduleMatches(monday, new Date("2026-09-28T17:00:00.000Z"), "UTC"), true);
});

test("overnight and full-day windows use the selected start day", () => {
  const overnight = [window(["SATURDAY"], "20:00", "02:00")];
  assert.equal(promotionScheduleMatches(overnight, new Date("2026-09-26T21:00:00.000Z"), "UTC"), true);
  assert.equal(promotionScheduleMatches(overnight, new Date("2026-09-27T01:30:00.000Z"), "UTC"), true);
  assert.equal(promotionScheduleMatches(overnight, new Date("2026-09-27T02:00:00.000Z"), "UTC"), false);
  assert.equal(promotionScheduleMatches([window(["SATURDAY"], null, null, true)], new Date("2026-09-26T23:59:00.000Z"), "UTC"), true);
  assert.equal(promotionScheduleMatches([window(["SATURDAY"], null, null, true)], new Date("2026-09-27T00:00:00.000Z"), "UTC"), false);
});

test("weekly local times follow tenant timezone and overall promotion dates", () => {
  const scheduleWindows = [window(["SATURDAY"], "16:00", "19:00")];
  const now = new Date("2026-09-26T12:30:00.000Z");
  assert.equal(promotionScheduleMatches(scheduleWindows, now, "Asia/Tehran"), true);
  assert.equal(promotionScheduleMatches(scheduleWindows, now, "UTC"), false);
  const promotion = { isActive: true, startAt: new Date("2026-09-26T00:00:00.000Z"), endAt: new Date("2026-10-01T00:00:00.000Z"), scheduleWindows };
  assert.equal(promotionStatus(promotion, now, "Asia/Tehran"), "RUNNING");
  assert.equal(promotionStatus(promotion, now, "UTC"), "OUTSIDE_SCHEDULE");
  assert.equal(promotionStatus({ ...promotion, endAt: now }, now, "Asia/Tehran"), "EXPIRED");
});
