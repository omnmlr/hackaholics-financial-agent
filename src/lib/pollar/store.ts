/**
 * In-memory / durable draft & session store for Pollar payment integration.
 * Ensures idempotency, auditability, and atomic state transitions.
 */

import type { PollarPaymentDraft, PollarWalletSession, PollarPaymentReceipt } from "./contracts";

export class PollarMemoryStore {
  private drafts: Map<string, PollarPaymentDraft> = new Map();
  private idempotencyIndex: Map<string, string> = new Map(); // idempotencyKey -> draftId
  private sessions: Map<string, PollarWalletSession> = new Map(); // owner/userId -> session
  private receipts: Map<string, PollarPaymentReceipt> = new Map(); // receiptId -> receipt

  async saveSession(session: PollarWalletSession): Promise<void> {
    this.sessions.set(session.userId, { ...session });
  }

  async getSession(userId: string): Promise<PollarWalletSession | null> {
    const s = this.sessions.get(userId);
    return s ? { ...s } : null;
  }

  async deleteSession(userId: string): Promise<boolean> {
    return this.sessions.delete(userId);
  }

  async saveDraft(draft: PollarPaymentDraft): Promise<void> {
    this.drafts.set(draft.id, { ...draft });
    this.idempotencyIndex.set(draft.idempotencyKey, draft.id);
  }

  async getDraft(draftId: string): Promise<PollarPaymentDraft | null> {
    const d = this.drafts.get(draftId);
    return d ? { ...d } : null;
  }

  async getDraftByIdempotencyKey(key: string): Promise<PollarPaymentDraft | null> {
    const draftId = this.idempotencyIndex.get(key);
    if (!draftId) return null;
    return this.getDraft(draftId);
  }

  async updateDraft(
    draftId: string,
    updater: (draft: PollarPaymentDraft) => PollarPaymentDraft,
  ): Promise<PollarPaymentDraft> {
    const existing = this.drafts.get(draftId);
    if (!existing) {
      throw new Error(`Pollar draft '${draftId}' not found`);
    }
    const updated = updater({ ...existing });
    this.drafts.set(draftId, updated);
    return { ...updated };
  }

  async saveReceipt(receipt: PollarPaymentReceipt): Promise<void> {
    this.receipts.set(receipt.receiptId, { ...receipt });
  }

  async getReceipt(receiptId: string): Promise<PollarPaymentReceipt | null> {
    const r = this.receipts.get(receiptId);
    return r ? { ...r } : null;
  }

  clear(): void {
    this.drafts.clear();
    this.idempotencyIndex.clear();
    this.sessions.clear();
    this.receipts.clear();
  }
}

export const defaultPollarStore = new PollarMemoryStore();
