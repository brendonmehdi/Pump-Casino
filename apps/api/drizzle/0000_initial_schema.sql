CREATE TYPE "public"."commitment_status" AS ENUM('PREPARED', 'CONSUMED', 'REVOKED');--> statement-breakpoint
CREATE TYPE "public"."ledger_entry_type" AS ENUM('INITIAL_GRANT', 'BET_DEBIT', 'PAYOUT_CREDIT');--> statement-breakpoint
CREATE TYPE "public"."player_action" AS ENUM('START', 'PUMP', 'CASHOUT', 'ROTATE');--> statement-breakpoint
CREATE TYPE "public"."round_status" AS ENUM('ACTIVE', 'POPPED', 'CASHED_OUT', 'EXPIRED');--> statement-breakpoint
CREATE TYPE "public"."settlement_reason" AS ENUM('MANUAL', 'AUTO_TARGET', 'LADDER_TOP');--> statement-breakpoint
CREATE TABLE "action_requests" (
	"player_id" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"action" "player_action" NOT NULL,
	"request_hash" text NOT NULL,
	"status_code" smallint NOT NULL,
	"response_body" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "action_requests_player_id_idempotency_key_pk" PRIMARY KEY("player_id","idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "players" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_token_hash" "bytea" NOT NULL,
	"balance_cents" bigint NOT NULL,
	"next_nonce" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "players_session_token_hash_unique" UNIQUE("session_token_hash"),
	CONSTRAINT "players_balance_non_negative" CHECK ("players"."balance_cents" >= 0),
	CONSTRAINT "players_next_nonce_positive" CHECK ("players"."next_nonce" >= 1),
	CONSTRAINT "players_session_hash_length" CHECK (octet_length("players"."session_token_hash") = 32)
);
--> statement-breakpoint
CREATE TABLE "rounds" (
	"id" uuid PRIMARY KEY NOT NULL,
	"player_id" uuid NOT NULL,
	"nonce" integer NOT NULL,
	"rules_version" text NOT NULL,
	"client_seed" text NOT NULL,
	"bet_cents" bigint NOT NULL,
	"auto_cashout_hundredths" integer,
	"status" "round_status" DEFAULT 'ACTIVE' NOT NULL,
	"settlement_reason" "settlement_reason",
	"pump_count" smallint DEFAULT 0 NOT NULL,
	"pop_point" smallint,
	"version" integer DEFAULT 0 NOT NULL,
	"payout_cents" bigint,
	"started_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	CONSTRAINT "rounds_bet_positive" CHECK ("rounds"."bet_cents" > 0),
	CONSTRAINT "rounds_pump_count_non_negative" CHECK ("rounds"."pump_count" >= 0),
	CONSTRAINT "rounds_pop_point_positive" CHECK ("rounds"."pop_point" is null or "rounds"."pop_point" >= 1),
	CONSTRAINT "rounds_version_non_negative" CHECK ("rounds"."version" >= 0),
	CONSTRAINT "rounds_expiry_after_start" CHECK ("rounds"."expires_at" > "rounds"."started_at"),
	CONSTRAINT "rounds_active_shape" CHECK ("rounds"."status" <> 'ACTIVE' or ("rounds"."ended_at" is null and "rounds"."payout_cents" is null
        and "rounds"."settlement_reason" is null
        and ("rounds"."pop_point" is null or "rounds"."pump_count" < "rounds"."pop_point"))),
	CONSTRAINT "rounds_cashed_out_shape" CHECK ("rounds"."status" <> 'CASHED_OUT' or ("rounds"."ended_at" is not null and "rounds"."payout_cents" > 0
        and "rounds"."settlement_reason" is not null and "rounds"."pump_count" >= 1
        and ("rounds"."pop_point" is null or "rounds"."pump_count" < "rounds"."pop_point"))),
	CONSTRAINT "rounds_popped_shape" CHECK ("rounds"."status" <> 'POPPED' or ("rounds"."ended_at" is not null and "rounds"."payout_cents" = 0
        and "rounds"."settlement_reason" is null and "rounds"."pop_point" = "rounds"."pump_count" + 1)),
	CONSTRAINT "rounds_expired_shape" CHECK ("rounds"."status" <> 'EXPIRED' or ("rounds"."ended_at" is not null and "rounds"."payout_cents" = 0
        and "rounds"."settlement_reason" is null
        and ("rounds"."pop_point" is null or "rounds"."pump_count" < "rounds"."pop_point")))
);
--> statement-breakpoint
CREATE TABLE "seed_commitments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"player_id" uuid NOT NULL,
	"nonce" integer NOT NULL,
	"server_seed" "bytea" NOT NULL,
	"commitment" text NOT NULL,
	"status" "commitment_status" DEFAULT 'PREPARED' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "seed_commitments_seed_length" CHECK (octet_length("seed_commitments"."server_seed") = 32),
	CONSTRAINT "seed_commitments_commitment_hex" CHECK ("seed_commitments"."commitment" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "seed_commitments_nonce_positive" CHECK ("seed_commitments"."nonce" >= 1),
	CONSTRAINT "seed_commitments_resolution" CHECK (("seed_commitments"."status" = 'PREPARED') = ("seed_commitments"."resolved_at" is null))
);
--> statement-breakpoint
CREATE TABLE "wallet_transactions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"player_id" uuid NOT NULL,
	"round_id" uuid,
	"entry_type" "ledger_entry_type" NOT NULL,
	"amount_cents" bigint NOT NULL,
	"balance_after_cents" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wallet_balance_after_non_negative" CHECK ("wallet_transactions"."balance_after_cents" >= 0),
	CONSTRAINT "wallet_entry_shape" CHECK (("wallet_transactions"."entry_type" = 'INITIAL_GRANT' and "wallet_transactions"."round_id" is null and "wallet_transactions"."amount_cents" > 0)
        or ("wallet_transactions"."entry_type" = 'BET_DEBIT' and "wallet_transactions"."round_id" is not null and "wallet_transactions"."amount_cents" < 0)
        or ("wallet_transactions"."entry_type" = 'PAYOUT_CREDIT' and "wallet_transactions"."round_id" is not null and "wallet_transactions"."amount_cents" > 0))
);
--> statement-breakpoint
ALTER TABLE "action_requests" ADD CONSTRAINT "action_requests_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rounds" ADD CONSTRAINT "rounds_id_seed_commitments_id_fk" FOREIGN KEY ("id") REFERENCES "public"."seed_commitments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rounds" ADD CONSTRAINT "rounds_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seed_commitments" ADD CONSTRAINT "seed_commitments_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_round_id_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."rounds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "rounds_one_active_per_player" ON "rounds" USING btree ("player_id") WHERE "rounds"."status" = 'ACTIVE';--> statement-breakpoint
CREATE UNIQUE INDEX "rounds_player_nonce" ON "rounds" USING btree ("player_id","nonce");--> statement-breakpoint
CREATE UNIQUE INDEX "seed_commitments_one_prepared_per_player" ON "seed_commitments" USING btree ("player_id") WHERE "seed_commitments"."status" = 'PREPARED';--> statement-breakpoint
CREATE UNIQUE INDEX "seed_commitments_player_nonce" ON "seed_commitments" USING btree ("player_id","nonce");--> statement-breakpoint
CREATE UNIQUE INDEX "wallet_one_grant_per_player" ON "wallet_transactions" USING btree ("player_id") WHERE "wallet_transactions"."entry_type" = 'INITIAL_GRANT';--> statement-breakpoint
CREATE UNIQUE INDEX "wallet_one_entry_per_round_and_type" ON "wallet_transactions" USING btree ("round_id","entry_type") WHERE "wallet_transactions"."round_id" is not null;--> statement-breakpoint
CREATE INDEX "wallet_transactions_player" ON "wallet_transactions" USING btree ("player_id","id");