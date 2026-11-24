CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`format` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`stage` integer DEFAULT 0 NOT NULL,
	`score` integer,
	`role` text DEFAULT 'Untitled role' NOT NULL,
	`company` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`lease_until` integer DEFAULT 0 NOT NULL,
	`error` text,
	`request_key` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `jobs_owner_created` ON `jobs` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `jobs_expiry` ON `jobs` (`expires_at`);--> statement-breakpoint
CREATE TABLE `limits` (
	`key` text PRIMARY KEY NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	`expires_at` integer NOT NULL
);
