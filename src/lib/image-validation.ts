import sharp from "sharp";
import { AppError } from "./domain";

/** Decode before inference. Bound pixels/frames, reject MIME confusion and
 * broken/truncated files; re-encode to discard metadata and trailing payloads. */
export async function normalizePaymentImage(bytes: Buffer, mime: string) {
  if (bytes.length > 5 * 1024 * 1024)
    throw new AppError("Image must be smaller than 5 MB", 413);
  const expected = {
    "image/png": "png",
    "image/jpeg": "jpeg",
    "image/webp": "webp",
  }[mime];
  if (!expected || bytes.length < 12)
    throw new AppError("Upload a valid PNG, JPEG or WebP image", 415);
  try {
    const image = sharp(bytes, {
      limitInputPixels: 16_000_000,
      failOn: "warning",
      animated: false,
    });
    const metadata = await image.metadata();
    if (
      metadata.format !== expected ||
      (metadata.pages ?? 1) !== 1 ||
      !metadata.width ||
      !metadata.height
    )
      throw Error();
    const normalized = await image
      .timeout({ seconds: 10 })
      .rotate()
      .resize({
        width: 2400,
        height: 2400,
        fit: "inside",
        withoutEnlargement: true,
      })
      .png()
      .toBuffer();
    if (normalized.length > 10 * 1024 * 1024) throw Error();
    return normalized;
  } catch {
    throw new AppError(
      "Upload a valid, decodable, single-frame PNG, JPEG or WebP image within 16 megapixels",
      415,
    );
  }
}
