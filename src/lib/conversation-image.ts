import { z } from "zod";
import { chatHistory } from "./chat-history/store";
import { mutate, readState } from "./db";
import { AppError, now } from "./domain";
import { extractImage } from "./intelligence";
import { normalizePaymentImage } from "./image-validation";

/** No image bytes/URLs/transcriptions are stored. Only reviewed-draft fields
 * and an owned idempotency claim survive. A failed upload needs an explicit new
 * attempt; same-ID retries reopen the saved result or fail closed. */
export async function conversationImage(
  owner: string,
  conversationId: string,
  uploadId: string,
  bytes: Buffer,
  mime: string,
) {
  z.uuid().parse(conversationId);
  z.uuid().parse(uploadId);
  const old = (await readState()).messages.find(
    (m) => m.id === uploadId && m.owner === owner,
  );
  if (old) {
    if (old.conversationId !== conversationId)
      throw new AppError("Image attempt belongs to another conversation", 409);
    const turn = (await chatHistory(owner).read(conversationId)).find(
      (t) => t.id === old.turnId,
    );
    if (turn) return { conversationId, turn };
    throw new AppError(
      "This image attempt is incomplete. Check the saved conversation, then select the image again for a new attempt.",
      409,
    );
  }
  // Validate before claiming durable work or invoking the model.
  const normalized = await normalizePaymentImage(bytes, mime);
  const history = chatHistory(owner),
    text = "Review payment instructions from an image";
  const lease = await history.claim(conversationId, text);
  try {
    await mutate((s) => {
      if (s.messages.some((m) => m.id === uploadId))
        throw new AppError("Image attempt already exists", 409);
      s.messages.push({
        id: uploadId,
        owner,
        role: "assistant",
        at: now(),
        compositionVersion: 1,
        generation: "manual",
        topic: "image_processing",
        content: "Reading an untrusted image",
        conversationId,
        sourceRequest: "Ephemeral image; raw content not retained",
      });
    });
    const { proposals } = await extractImage(normalized, "image/png");
    const turn = await history.finish(conversationId, lease, text, {
      kind: proposals.length ? "handoff" : "clarify",
      text: proposals.length
        ? `I read ${proposals.length === 1 ? "one payment instruction" : `${proposals.length} payment instructions`}. Review the editable details below. Missing or conflicting fields need your confirmation. No beneficiary is verified and nothing has been sent.`
        : "I couldn’t establish clear payment instructions in that image. What would you like to do with it? You can also type the details.",
      ...(proposals.length
        ? { handoff: { kind: "existing_payment_draft" as const } }
        : {}),
      citations: [],
      evidence: {
        modelCalls: proposals.length ? 2 : 1,
        toolCalls: 0,
        resultBytes: 0,
      },
    });
    await mutate((s) => {
      const m = s.messages.find((m) => m.id === uploadId && m.owner === owner)!;
      m.turnId = turn.id;
      m.topic = "prepare";
      m.proposals = proposals;
      m.content = turn.reply.text;
    });
    return { conversationId, turn };
  } catch (error) {
    await history.release(conversationId, lease);
    await mutate((s) => {
      const m = s.messages.find((m) => m.id === uploadId && m.owner === owner);
      if (m) m.topic = "image_failed";
    });
    throw error;
  }
}
