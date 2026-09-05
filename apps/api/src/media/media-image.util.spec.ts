import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { MediaAssetKind } from "./entities";
import { createVariants, inspectImage, MAX_MEDIA_BYTES } from "./media-image.util";

test("valid hero bytes are inspected and converted to WebP and AVIF variants", async () => {
  const source = await sharp({ create: { width: 1200, height: 675, channels: 3, background: "#6f4e37" } }).jpeg().toBuffer();
  const metadata = await inspectImage(source, MediaAssetKind.Hero);
  assert.equal(metadata.width, 1200); assert.equal(metadata.height, 675); assert.equal(metadata.format, "jpeg");
  const variants = await createVariants(source, MediaAssetKind.Hero);
  assert.equal((await sharp(variants["large-avif"]).metadata()).format, "heif");
  assert.equal((await sharp(variants["small-webp"]).metadata()).format, "webp");
  assert.ok(variants["large-avif"].length < source.length);
});

test("spoofed, undersized, and oversized inputs fail closed", async () => {
  await assert.rejects(() => inspectImage(Buffer.from("not an image"), MediaAssetKind.Logo));
  const tiny = await sharp({ create: { width: 32, height: 32, channels: 3, background: "white" } }).png().toBuffer();
  await assert.rejects(() => inspectImage(tiny, MediaAssetKind.Logo));
  await assert.rejects(() => inspectImage(Buffer.alloc(MAX_MEDIA_BYTES + 1), MediaAssetKind.Gallery));
});

test("menu item images require 600px square-capable sources and emit square variants", async () => {
  const valid = await sharp({ create: { width: 720, height: 640, channels: 3, background: "#2b1710" } }).png().toBuffer();
  const variants = await createVariants(valid, MediaAssetKind.MenuItem);
  assert.deepEqual(
    [(await sharp(variants["small-webp"]).metadata()).width, (await sharp(variants["small-webp"]).metadata()).height],
    [480, 480],
  );
  assert.deepEqual(
    [(await sharp(variants["large-avif"]).metadata()).width, (await sharp(variants["large-avif"]).metadata()).height],
    [960, 960],
  );
  const undersized = await sharp({ create: { width: 599, height: 900, channels: 3, background: "#2b1710" } }).png().toBuffer();
  await assert.rejects(() => inspectImage(undersized, MediaAssetKind.MenuItem), /MENU_ITEM image is too small/);
});
