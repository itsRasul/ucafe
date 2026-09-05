import { BadRequestException } from "@nestjs/common";
import sharp from "sharp";
import { MediaAssetKind } from "./entities";

export const MAX_MEDIA_BYTES = 8 * 1024 * 1024;
export const MAX_MEDIA_PIXELS = 24_000_000;
export const MEDIA_VARIANTS = ["small-webp", "large-webp", "small-avif", "large-avif"] as const;
export type MediaVariant = (typeof MEDIA_VARIANTS)[number];

const allowedFormats = new Set(["jpeg", "png", "webp"]);
const dimensions: Record<MediaAssetKind, { minWidth: number; minHeight: number; small: [number, number]; large: [number, number] }> = {
  LOGO: { minWidth: 256, minHeight: 256, small: [128, 128], large: [256, 256] },
  HERO: { minWidth: 1200, minHeight: 675, small: [960, 720], large: [1600, 1000] },
  GALLERY: { minWidth: 800, minHeight: 600, small: [640, 480], large: [1200, 900] },
  MENU_ITEM: { minWidth: 600, minHeight: 600, small: [480, 480], large: [960, 960] },
};

export async function inspectImage(input: Buffer, kind: MediaAssetKind) {
  if (!input.length || input.length > MAX_MEDIA_BYTES) throw new BadRequestException("Image must be between 1 byte and 8 MB");
  let metadata: sharp.Metadata;
  try { metadata = await sharp(input, { limitInputPixels: MAX_MEDIA_PIXELS, failOn: "warning" }).metadata(); }
  catch { throw new BadRequestException("Image data is invalid or exceeds the pixel limit"); }
  if (!metadata.format || !allowedFormats.has(metadata.format) || !metadata.width || !metadata.height) throw new BadRequestException("Only valid JPEG, PNG, or WebP images are accepted");
  const rule = dimensions[kind];
  if (metadata.width < rule.minWidth || metadata.height < rule.minHeight) throw new BadRequestException(`${kind} image is too small`);
  return { format: metadata.format, width: metadata.width, height: metadata.height };
}

export async function createVariants(input: Buffer, kind: MediaAssetKind): Promise<Record<MediaVariant, Buffer>> {
  const rule = dimensions[kind];
  const render = (size: [number, number]) => sharp(input, { limitInputPixels: MAX_MEDIA_PIXELS }).rotate().resize(size[0], size[1], { fit: "cover", position: "centre", withoutEnlargement: false });
  return {
    "small-webp": await render(rule.small).webp({ quality: 76, effort: 5 }).toBuffer(),
    "large-webp": await render(rule.large).webp({ quality: 82, effort: 5 }).toBuffer(),
    "small-avif": await render(rule.small).avif({ quality: 50, effort: 5 }).toBuffer(),
    "large-avif": await render(rule.large).avif({ quality: 58, effort: 5 }).toBuffer(),
  };
}

export function isMediaVariant(value: string): value is MediaVariant { return (MEDIA_VARIANTS as readonly string[]).includes(value); }
