-- The wallet ledger is append-only: corrections must be new entries, never edits or deletes.
CREATE FUNCTION reject_wallet_transaction_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'wallet_transactions is append-only (% rejected)', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER wallet_transactions_append_only
  BEFORE UPDATE OR DELETE ON wallet_transactions
  FOR EACH ROW EXECUTE FUNCTION reject_wallet_transaction_mutation();
