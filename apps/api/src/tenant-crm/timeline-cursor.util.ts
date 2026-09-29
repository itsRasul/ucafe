import { BadRequestException } from "@nestjs/common";

export type TimelineCursor = { occurredAt: string; eventKey: string };

const cursorEventKey = /^(?:(?:CLIENT|ORDER|RESERVATION|NOTE|REMINDER):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:(?:CREATED|COMPLETED|STATUS:[A-Z_]+)|FEEDBACK:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:(?:CREATED|RESOLVED)|LOYALTY_LEDGER:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|OFFER_ELIGIBILITY:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|OFFER_ORDER:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

export function encodeTimelineCursor(cursor: TimelineCursor) {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

export function decodeTimelineCursor(value?: string): TimelineCursor | undefined {
  if (value === undefined) return undefined;
  try {
    if (!value || value.length > 512 || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error();
    const decoded = Buffer.from(value, "base64url").toString("utf8");
    if (Buffer.from(decoded).toString("base64url") !== value) throw new Error();
    const cursor = JSON.parse(decoded) as Partial<TimelineCursor>;
    if (typeof cursor.occurredAt !== "string" || new Date(cursor.occurredAt).toISOString() !== cursor.occurredAt
      || typeof cursor.eventKey !== "string" || !cursorEventKey.test(cursor.eventKey)) throw new Error();
    return { occurredAt: cursor.occurredAt, eventKey: cursor.eventKey };
  } catch {
    throw new BadRequestException("Invalid timeline cursor");
  }
}
