CREATE TABLE `acceptance` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`quote_id` text NOT NULL,
	`revision_id` text NOT NULL,
	`full_name` text NOT NULL,
	`ip` text,
	`user_agent` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenant`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`quote_id`) REFERENCES `quote`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`revision_id`) REFERENCES `quote_revision`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `acceptance_revision_id_unique` ON `acceptance` (`revision_id`);--> statement-breakpoint
CREATE TABLE `activity` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`subject_type` text NOT NULL,
	`subject_id` text NOT NULL,
	`organization_id` text,
	`opportunity_id` text,
	`booking_id` text,
	`kind` text NOT NULL,
	`body` text,
	`data` text,
	`user_id` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenant`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `activity_subject_idx` ON `activity` (`tenant_id`,`subject_type`,`subject_id`);--> statement-breakpoint
CREATE INDEX `activity_org_idx` ON `activity` (`tenant_id`,`organization_id`);--> statement-breakpoint
CREATE INDEX `activity_opp_idx` ON `activity` (`tenant_id`,`opportunity_id`);--> statement-breakpoint
CREATE INDEX `activity_booking_idx` ON `activity` (`tenant_id`,`booking_id`);--> statement-breakpoint
CREATE TABLE `booking` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`number` integer NOT NULL,
	`opportunity_id` text,
	`contact_id` text,
	`organization_id` text,
	`quote_id` text,
	`revision_id` text,
	`series_id` text,
	`booking_type` text NOT NULL,
	`status` text NOT NULL,
	`pricing_term` text NOT NULL,
	`title` text NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text NOT NULL,
	`start_time` text,
	`end_time` text,
	`location` text,
	`expected_attendance` integer,
	`total_cents` integer,
	`deposit_cents` integer DEFAULT 0 NOT NULL,
	`split_bps` integer,
	`guarantee_cents` integer,
	`staff_required` integer DEFAULT 0 NOT NULL,
	`fulfillment` text,
	`dispatch_time` text,
	`return_time` text,
	`delivery_address` text,
	`customer_instructions` text,
	`confirmation_sent_at` text,
	`venue_contact` text,
	`load_in_time` text,
	`channels` integer,
	`run_of_show` text,
	`needs_invoice` integer DEFAULT false NOT NULL,
	`invoice_error` text,
	`confirmed_at` text,
	`confirm_override_reason` text,
	`overbooking_acknowledged` integer DEFAULT false NOT NULL,
	`cancelled_at` text,
	`cancel_reason` text,
	`closed_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenant`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`opportunity_id`) REFERENCES `opportunity`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`contact_id`) REFERENCES `contact`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`quote_id`) REFERENCES `quote`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`revision_id`) REFERENCES `quote_revision`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `booking_number_uq` ON `booking` (`tenant_id`,`number`);--> statement-breakpoint
CREATE INDEX `booking_dates_idx` ON `booking` (`tenant_id`,`start_date`,`end_date`);--> statement-breakpoint
CREATE INDEX `booking_status_idx` ON `booking` (`tenant_id`,`status`);--> statement-breakpoint
CREATE INDEX `booking_series_idx` ON `booking` (`series_id`);--> statement-breakpoint
CREATE TABLE `booking_staff` (
	`tenant_id` text NOT NULL,
	`booking_id` text NOT NULL,
	`staff_member_id` text NOT NULL,
	PRIMARY KEY(`booking_id`, `staff_member_id`),
	FOREIGN KEY (`tenant_id`) REFERENCES `tenant`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`booking_id`) REFERENCES `booking`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`staff_member_id`) REFERENCES `staff_member`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `charge` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`booking_id` text NOT NULL,
	`kind` text NOT NULL,
	`proposed_cents` integer NOT NULL,
	`amount_cents` integer,
	`status` text NOT NULL,
	`reason` text,
	`square_payment_id` text,
	`invoice_id` text,
	`decided_by` text,
	`decided_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenant`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`booking_id`) REFERENCES `booking`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`decided_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `charge_booking_idx` ON `charge` (`booking_id`);--> statement-breakpoint
CREATE TABLE `checkout_item` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`record_id` text NOT NULL,
	`equipment_type_id` text NOT NULL,
	`unit_id` text,
	`quantity` integer NOT NULL,
	`damaged` integer DEFAULT 0 NOT NULL,
	`missing` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenant`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`record_id`) REFERENCES `checkout_record`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`equipment_type_id`) REFERENCES `equipment_type`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`unit_id`) REFERENCES `equipment_unit`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `checkout_item_record_idx` ON `checkout_item` (`record_id`);--> statement-breakpoint
CREATE TABLE `checkout_record` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`booking_id` text NOT NULL,
	`kind` text NOT NULL,
	`note` text,
	`user_id` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenant`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`booking_id`) REFERENCES `booking`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `checkout_record_booking_idx` ON `checkout_record` (`booking_id`);--> statement-breakpoint
CREATE TABLE `contact` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`organization_id` text,
	`name` text NOT NULL,
	`role` text,
	`email` text,
	`phone` text,
	`notes` text,
	`square_customer_id` text,
	`archived_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenant`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `contact_tenant_idx` ON `contact` (`tenant_id`,`name`);--> statement-breakpoint
CREATE INDEX `contact_email_idx` ON `contact` (`tenant_id`,`email`);--> statement-breakpoint
CREATE INDEX `contact_org_idx` ON `contact` (`organization_id`);--> statement-breakpoint
CREATE TABLE `counter` (
	`tenant_id` text NOT NULL,
	`name` text NOT NULL,
	`value` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`tenant_id`, `name`),
	FOREIGN KEY (`tenant_id`) REFERENCES `tenant`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `equipment_requirement` (
	`tenant_id` text NOT NULL,
	`booking_id` text NOT NULL,
	`equipment_type_id` text NOT NULL,
	`quantity` integer NOT NULL,
	`loss_fee_cents` integer,
	PRIMARY KEY(`booking_id`, `equipment_type_id`),
	FOREIGN KEY (`tenant_id`) REFERENCES `tenant`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`booking_id`) REFERENCES `booking`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`equipment_type_id`) REFERENCES `equipment_type`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `equipment_type` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`name` text NOT NULL,
	`tracking_mode` text NOT NULL,
	`owned_quantity` integer DEFAULT 0 NOT NULL,
	`out_of_service_quantity` integer DEFAULT 0 NOT NULL,
	`loss_fee_cents` integer DEFAULT 0 NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenant`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `equipment_unit` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`equipment_type_id` text NOT NULL,
	`label` text NOT NULL,
	`status` text DEFAULT 'in_service' NOT NULL,
	`notes` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenant`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`equipment_type_id`) REFERENCES `equipment_type`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `equipment_unit_label_uq` ON `equipment_unit` (`tenant_id`,`equipment_type_id`,`label`);--> statement-breakpoint
CREATE TABLE `inventory_adjustment` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`equipment_type_id` text NOT NULL,
	`unit_id` text,
	`delta` integer NOT NULL,
	`reason` text NOT NULL,
	`note` text,
	`booking_id` text,
	`user_id` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenant`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`equipment_type_id`) REFERENCES `equipment_type`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`unit_id`) REFERENCES `equipment_unit`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`booking_id`) REFERENCES `booking`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `inventory_adjustment_type_idx` ON `inventory_adjustment` (`tenant_id`,`equipment_type_id`);--> statement-breakpoint
CREATE TABLE `invoice` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`booking_id` text NOT NULL,
	`charge_id` text,
	`kind` text NOT NULL,
	`status` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`deposit_cents` integer DEFAULT 0 NOT NULL,
	`deposit_due_date` text,
	`due_date` text NOT NULL,
	`paid_cents` integer DEFAULT 0 NOT NULL,
	`square_invoice_id` text,
	`square_order_id` text,
	`square_version` integer,
	`public_url` text,
	`last_error` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenant`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`booking_id`) REFERENCES `booking`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `invoice_booking_idx` ON `invoice` (`booking_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `invoice_square_uq` ON `invoice` (`square_invoice_id`);--> statement-breakpoint
CREATE TABLE `job` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text,
	`type` text NOT NULL,
	`payload` text DEFAULT '{}' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`max_attempts` integer DEFAULT 8 NOT NULL,
	`run_at` text NOT NULL,
	`locked_at` text,
	`last_error` text,
	`idempotency_key` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenant`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `job_due_idx` ON `job` (`status`,`run_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `job_idempotency_uq` ON `job` (`idempotency_key`);--> statement-breakpoint
CREATE TABLE `opportunity` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`title` text NOT NULL,
	`organization_id` text,
	`contact_id` text,
	`stage` text NOT NULL,
	`service_interest` text,
	`event_date` text,
	`expected_attendance` integer,
	`estimated_value_cents` integer,
	`source` text DEFAULT 'manual' NOT NULL,
	`loss_reason` text,
	`loss_note` text,
	`needs_loss_reason` integer DEFAULT false NOT NULL,
	`notes` text,
	`stage_changed_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`closed_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenant`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`contact_id`) REFERENCES `contact`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `opportunity_tenant_stage_idx` ON `opportunity` (`tenant_id`,`stage`);--> statement-breakpoint
CREATE INDEX `opportunity_org_idx` ON `opportunity` (`organization_id`);--> statement-breakpoint
CREATE INDEX `opportunity_contact_idx` ON `opportunity` (`contact_id`);--> statement-breakpoint
CREATE TABLE `organization` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`city` text,
	`address` text,
	`website` text,
	`phone` text,
	`notes` text,
	`archived_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenant`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `organization_tenant_idx` ON `organization` (`tenant_id`,`name`);--> statement-breakpoint
CREATE TABLE `outbound_email` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`to` text NOT NULL,
	`subject` text NOT NULL,
	`text` text NOT NULL,
	`html` text,
	`status` text NOT NULL,
	`error` text,
	`related_type` text,
	`related_id` text,
	`sent_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenant`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `outbound_email_tenant_idx` ON `outbound_email` (`tenant_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `package_item` (
	`tenant_id` text NOT NULL,
	`package_id` text NOT NULL,
	`equipment_type_id` text NOT NULL,
	`quantity` integer NOT NULL,
	`loss_fee_cents` integer,
	PRIMARY KEY(`package_id`, `equipment_type_id`),
	FOREIGN KEY (`tenant_id`) REFERENCES `tenant`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`package_id`) REFERENCES `rental_package`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`equipment_type_id`) REFERENCES `equipment_type`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `payment` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`booking_id` text NOT NULL,
	`invoice_id` text,
	`source` text NOT NULL,
	`method` text,
	`amount_cents` integer NOT NULL,
	`received_on` text NOT NULL,
	`square_payment_id` text,
	`note` text,
	`user_id` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenant`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`booking_id`) REFERENCES `booking`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoice`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `payment_booking_idx` ON `payment` (`booking_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `payment_square_uq` ON `payment` (`square_payment_id`);--> statement-breakpoint
CREATE TABLE `quote` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`number` integer NOT NULL,
	`opportunity_id` text NOT NULL,
	`booking_type` text NOT NULL,
	`status` text NOT NULL,
	`current_revision_id` text,
	`sent_at` text,
	`accepted_at` text,
	`declined_at` text,
	`decline_reason` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenant`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`opportunity_id`) REFERENCES `opportunity`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `quote_number_uq` ON `quote` (`tenant_id`,`number`);--> statement-breakpoint
CREATE INDEX `quote_opp_idx` ON `quote` (`opportunity_id`);--> statement-breakpoint
CREATE TABLE `quote_line` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`revision_id` text NOT NULL,
	`position` integer NOT NULL,
	`kind` text NOT NULL,
	`description` text NOT NULL,
	`quantity` integer NOT NULL,
	`unit_price_cents` integer NOT NULL,
	`package_id` text,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenant`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`revision_id`) REFERENCES `quote_revision`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`package_id`) REFERENCES `rental_package`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `quote_line_rev_idx` ON `quote_line` (`revision_id`);--> statement-breakpoint
CREATE TABLE `quote_request` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`opportunity_id` text,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`phone` text,
	`organization` text,
	`service_interest` text NOT NULL,
	`event_date` text NOT NULL,
	`expected_attendance` integer NOT NULL,
	`location` text NOT NULL,
	`message` text,
	`ip` text,
	`seen_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenant`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`opportunity_id`) REFERENCES `opportunity`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `quote_request_tenant_idx` ON `quote_request` (`tenant_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `quote_revision` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`quote_id` text NOT NULL,
	`revision_number` integer NOT NULL,
	`booking_type` text NOT NULL,
	`pricing_term` text NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text NOT NULL,
	`start_time` text,
	`end_time` text,
	`location` text,
	`inside_service_area` integer DEFAULT true NOT NULL,
	`expected_attendance` integer,
	`split_bps` integer,
	`guarantee_cents` integer,
	`deposit_bps` integer DEFAULT 0 NOT NULL,
	`total_cents` integer,
	`deposit_cents` integer DEFAULT 0 NOT NULL,
	`requirements` text DEFAULT '{}' NOT NULL,
	`staff_required` integer DEFAULT 0 NOT NULL,
	`occurrence_dates` text,
	`notes` text,
	`terms_text` text,
	`public_token` text,
	`token_revoked_at` text,
	`expires_on` text,
	`sent_at` text,
	`created_by` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenant`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`quote_id`) REFERENCES `quote`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `quote_revision_number_uq` ON `quote_revision` (`quote_id`,`revision_number`);--> statement-breakpoint
CREATE UNIQUE INDEX `quote_revision_token_uq` ON `quote_revision` (`public_token`);--> statement-breakpoint
CREATE TABLE `rental_package` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`price_cents` integer NOT NULL,
	`included_days` integer DEFAULT 1 NOT NULL,
	`extra_day_price_cents` integer DEFAULT 0 NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenant`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`user_id` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`last_seen_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`ip` text,
	`user_agent` text,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenant`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `session_user_idx` ON `session` (`user_id`);--> statement-breakpoint
CREATE TABLE `settlement` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`booking_id` text NOT NULL,
	`door_revenue_cents` integer NOT NULL,
	`split_bps` integer NOT NULL,
	`guarantee_cents` integer,
	`amount_cents` integer NOT NULL,
	`note` text,
	`user_id` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenant`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`booking_id`) REFERENCES `booking`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `staff_member` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`name` text NOT NULL,
	`email` text,
	`phone` text,
	`user_id` text,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenant`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `staff_unavailability` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`staff_member_id` text NOT NULL,
	`date` text NOT NULL,
	`note` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenant`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`staff_member_id`) REFERENCES `staff_member`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `staff_unavailability_uq` ON `staff_unavailability` (`staff_member_id`,`date`);--> statement-breakpoint
CREATE TABLE `tenant` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`time_zone` text DEFAULT 'America/Chicago' NOT NULL,
	`setup_required` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tenant_slug_unique` ON `tenant` (`slug`);--> statement-breakpoint
CREATE TABLE `tenant_settings` (
	`tenant_id` text PRIMARY KEY NOT NULL,
	`notification_email` text,
	`rental_deposit_bps` integer DEFAULT 2000 NOT NULL,
	`buffer_days` integer DEFAULT 1 NOT NULL,
	`rental_balance_due_days` integer DEFAULT 7 NOT NULL,
	`full_service_invoice_due_offset_days` integer DEFAULT 0 NOT NULL,
	`delivery_fee_cents` integer DEFAULT 7500 NOT NULL,
	`service_areas` text DEFAULT '["Milwaukee metro","Madison metro"]' NOT NULL,
	`quote_validity_days` integer DEFAULT 14 NOT NULL,
	`rental_terms` text DEFAULT '' NOT NULL,
	`full_service_terms` text DEFAULT '' NOT NULL,
	`rental_usage_instructions` text DEFAULT '' NOT NULL,
	`square_environment` text,
	`square_access_token_enc` text,
	`square_location_id` text,
	`square_location_name` text,
	`square_webhook_signature_key_enc` text,
	`square_connected_at` text,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenant`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`username` text NOT NULL,
	`display_name` text NOT NULL,
	`password_hash` text,
	`role` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`last_login_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenant`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_username_uq` ON `user` (`username`);--> statement-breakpoint
CREATE INDEX `user_tenant_idx` ON `user` (`tenant_id`);--> statement-breakpoint
CREATE TABLE `webhook_event` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text,
	`provider` text NOT NULL,
	`event_id` text NOT NULL,
	`type` text NOT NULL,
	`payload` text NOT NULL,
	`processed_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenant`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `webhook_event_event_id_unique` ON `webhook_event` (`event_id`);