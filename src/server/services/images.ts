import type { User } from "@prisma/client";
import { db } from "../db";
import { AppError } from "../errors";

// Images are resized in the browser before upload; the server still verifies
// type (by magic bytes, never by the client's claim), size and dimensions.
export const MAX_IMAGE_BYTES = 1_500_000;
const MAX_DIMENSION = 2048;
const MAX_IMAGES_PER_USER = 200;

/** Internal URL for an uploaded image. Character/profile avatars may use this or an https URL. */
export const IMAGE_PATH = /^\/api\/images\/[a-z0-9]{20,40}$/;

type Kind = { mime: string; dims: (b: Buffer) => { width: number; height: number } | null };

const KINDS: { test: (b: Buffer) => boolean; kind: Kind }[] = [
  {
    test: (b) => b.length > 24 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    kind: { mime: "image/png", dims: (b) => ({ width: b.readUInt32BE(16), height: b.readUInt32BE(20) }) },
  },
  {
    test: (b) => b.length > 4 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
    kind: { mime: "image/jpeg", dims: jpegDims },
  },
  {
    test: (b) => b.length > 30 && b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP",
    kind: { mime: "image/webp", dims: webpDims },
  },
];

function jpegDims(b: Buffer) {
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) return null;
    const marker = b[i + 1];
    const len = b.readUInt16BE(i + 2);
    // SOF0..SOF15 (except DHT/JPG/DAC) carry the frame size.
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
    }
    i += 2 + len;
  }
  return null;
}

function webpDims(b: Buffer) {
  const chunk = b.toString("ascii", 12, 16);
  if (chunk === "VP8X") return { width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3) };
  if (chunk === "VP8 ") return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
  if (chunk === "VP8L") {
    const bits = b.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  return null;
}

/** Identify an image from its bytes. Returns null for anything that is not PNG/JPEG/WebP. */
export function sniffImage(bytes: Buffer): { mime: string; width: number; height: number } | null {
  const match = KINDS.find((k) => k.test(bytes));
  if (!match) return null;
  const dims = match.kind.dims(bytes);
  if (!dims || dims.width < 1 || dims.height < 1) return null;
  return { mime: match.kind.mime, ...dims };
}

export async function storeImage(owner: User, bytes: Buffer) {
  if (bytes.length === 0) throw new AppError("bad_request", "The file is empty");
  if (bytes.length > MAX_IMAGE_BYTES) throw new AppError("bad_request", "Image is too large (max 1.5 MB after resizing)");
  const info = sniffImage(bytes);
  if (!info) throw new AppError("bad_request", "Only PNG, JPEG or WebP images are allowed");
  if (info.width > MAX_DIMENSION || info.height > MAX_DIMENSION) throw new AppError("bad_request", "Image dimensions are too large");
  const count = await db.image.count({ where: { ownerId: owner.id } });
  if (count >= MAX_IMAGES_PER_USER) throw new AppError("conflict", "You have uploaded too many images");
  const image = await db.image.create({
    data: { ownerId: owner.id, mime: info.mime, bytes: new Uint8Array(bytes), width: info.width, height: info.height },
    select: { id: true, width: true, height: true },
  });
  return { ...image, url: `/api/images/${image.id}` };
}

export async function loadImage(id: string) {
  return db.image.findUnique({ where: { id }, select: { mime: true, bytes: true } });
}
