import { ok, route } from "@/server/http";
import { requireActiveUser } from "@/server/auth/guards";
import { rateLimit } from "@/server/rate-limit";
import { AppError } from "@/server/errors";
import { MAX_IMAGE_BYTES, storeImage } from "@/server/services/images";

/** Upload one image (multipart field "file"). Returns its URL for use as an avatar. */
export const POST = route(async (req: Request) => {
  const user = await requireActiveUser();
  await rateLimit(`image-upload:${user.id}`, 30, 60 * 60 * 1000);
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > MAX_IMAGE_BYTES + 64_000) throw new AppError("bad_request", "Image is too large (max 1.5 MB after resizing)");
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) throw new AppError("bad_request", "No image file was sent");
  const image = await storeImage(user, Buffer.from(await file.arrayBuffer()));
  return ok(image, { status: 201 });
});
