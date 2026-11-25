CREATE TABLE "competitors" (
	"id" text PRIMARY KEY NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_at" timestamp with time zone,
	"awaiting_first_poll_reason" text
);
