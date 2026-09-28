export function pointsForSpend(amountToman: string | bigint, spendPerPointToman: string | bigint): bigint {
  const amount = BigInt(amountToman);
  const spendPerPoint = BigInt(spendPerPointToman);
  if (amount < 0n || spendPerPoint <= 0n) throw new RangeError("Invalid loyalty earning values");
  return amount / spendPerPoint;
}
