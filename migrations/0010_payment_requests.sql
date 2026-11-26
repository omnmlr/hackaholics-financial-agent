CREATE UNIQUE INDEX agus_payment_request_id ON agus_payment_requests(id);
CREATE TABLE agus_request_drafts (
 request_id text NOT NULL REFERENCES agus_payment_requests(id), payer text NOT NULL, draft_id text NOT NULL,
 PRIMARY KEY(request_id,payer,draft_id), FOREIGN KEY(payer,draft_id) REFERENCES agus_solana_drafts(owner,id)
);
