CREATE TABLE "snapshots" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"competitor_id" text NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	"poll_status" text NOT NULL,
	"failure_reason" text,
	"title" text,
	"tagline" text,
	"price" text,
	"price_amount" numeric,
	"price_currency" text,
	"price_period" text,
	"description" text,
	"changed" boolean DEFAULT false NOT NULL,
	"summary" text,
	"summary_status" text DEFAULT 'not_applicable' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "competitors" ADD COLUMN "next_poll_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "snapshots" ADD CONSTRAINT "snapshots_competitor_id_competitors_id_fk" FOREIGN KEY ("competitor_id") REFERENCES "public"."competitors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "snapshots_competitor_fetched_idx" ON "snapshots" USING btree ("competitor_id","fetched_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "competitors_next_poll_at_idx" ON "competitors" USING btree ("next_poll_at");