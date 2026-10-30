import { requireUser, errorResponse, HttpError } from "@/lib/auth";
import { deleteThread } from "@/lib/thread-store";
import { EARLIER, parseThreadRef } from "@/lib/threads";

type Ctx = { params: Promise<{ id: string }> };

/**
 * DELETE /api/threads/:id — take one of the caller's threads (`earlier` for the earlier history) off their list. Its
 * generations stay in the gallery and in every usage number, and a live one runs to its end. 404 for a thread the
 * caller cannot see, including one already deleted.
 */
export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    const user = await requireUser();
    const ref = parseThreadRef((await params).id);
    if (!ref) throw new HttpError(404, "noSuchThread");
    await deleteThread(user.id, ref);
    return Response.json({ id: ref.kind === "chat" ? ref.id : EARLIER });
  } catch (e) {
    return errorResponse(e);
  }
}
