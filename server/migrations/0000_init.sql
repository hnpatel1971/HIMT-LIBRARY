CREATE TABLE `audit_log` (
	`id` int AUTO_INCREMENT NOT NULL,
	`at` timestamp NOT NULL DEFAULT (now()),
	`user_id` int,
	`action` varchar(64) NOT NULL,
	`details` json,
	CONSTRAINT `audit_log_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `collection_types` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(100) NOT NULL,
	CONSTRAINT `collection_types_id` PRIMARY KEY(`id`),
	CONSTRAINT `collection_types_name_unique` UNIQUE(`name`)
);
--> statement-breakpoint
CREATE TABLE `copies` (
	`id` int AUTO_INCREMENT NOT NULL,
	`barcode` varchar(32) NOT NULL,
	`title_id` int NOT NULL,
	`location_id` int,
	`collection_type_id` int,
	`status` enum('available','repair','no_loan','missing','withdrawn') NOT NULL DEFAULT 'available',
	`call_number` varchar(64),
	`price` decimal(10,2),
	`supplier` varchar(128),
	`invoice` varchar(64),
	`received_on` date,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `copies_id` PRIMARY KEY(`id`),
	CONSTRAINT `copies_barcode_unique` UNIQUE(`barcode`)
);
--> statement-breakpoint
CREATE TABLE `fines` (
	`id` int AUTO_INCREMENT NOT NULL,
	`member_id` int NOT NULL,
	`loan_id` int,
	`amount` decimal(10,2) NOT NULL,
	`reason` varchar(600) NOT NULL,
	`charged_on` date NOT NULL,
	`waived` boolean NOT NULL DEFAULT false,
	`waived_by` int,
	CONSTRAINT `fines_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `formats` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(100) NOT NULL,
	CONSTRAINT `formats_id` PRIMARY KEY(`id`),
	CONSTRAINT `formats_name_unique` UNIQUE(`name`)
);
--> statement-breakpoint
CREATE TABLE `holidays` (
	`id` int AUTO_INCREMENT NOT NULL,
	`date` date NOT NULL,
	`description` varchar(128) NOT NULL,
	CONSTRAINT `holidays_id` PRIMARY KEY(`id`),
	CONSTRAINT `holidays_date_unique` UNIQUE(`date`)
);
--> statement-breakpoint
CREATE TABLE `loans` (
	`id` int AUTO_INCREMENT NOT NULL,
	`copy_id` int NOT NULL,
	`member_id` int NOT NULL,
	`issued_on` date NOT NULL,
	`due_on` date NOT NULL,
	`returned_on` date,
	`renew_count` int NOT NULL DEFAULT 0,
	`issued_by` int,
	`returned_by` int,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`open_copy_id` int GENERATED ALWAYS AS ((case when returned_on is null then copy_id end)) STORED,
	CONSTRAINT `loans_id` PRIMARY KEY(`id`),
	CONSTRAINT `loans_one_open_per_copy` UNIQUE(`open_copy_id`)
);
--> statement-breakpoint
CREATE TABLE `locations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(100) NOT NULL,
	CONSTRAINT `locations_id` PRIMARY KEY(`id`),
	CONSTRAINT `locations_name_unique` UNIQUE(`name`)
);
--> statement-breakpoint
CREATE TABLE `member_types` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(64) NOT NULL,
	`loan_limit` int NOT NULL DEFAULT 2,
	`loan_days` int NOT NULL DEFAULT 7,
	`renew_limit` int NOT NULL DEFAULT 1,
	`fine_per_day` decimal(10,2) NOT NULL DEFAULT '0',
	`reserve_limit` int NOT NULL DEFAULT 0,
	`membership_days` int NOT NULL DEFAULT 365,
	CONSTRAINT `member_types_id` PRIMARY KEY(`id`),
	CONSTRAINT `member_types_name_unique` UNIQUE(`name`)
);
--> statement-breakpoint
CREATE TABLE `members` (
	`id` int AUTO_INCREMENT NOT NULL,
	`code` varchar(32) NOT NULL,
	`name` varchar(128) NOT NULL,
	`type_id` int NOT NULL,
	`department` varchar(128),
	`email` varchar(128),
	`phone` varchar(32),
	`address` text,
	`joined_on` date,
	`expires_on` date,
	`active` boolean NOT NULL DEFAULT true,
	`notes` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `members_id` PRIMARY KEY(`id`),
	CONSTRAINT `members_code_unique` UNIQUE(`code`)
);
--> statement-breakpoint
CREATE TABLE `payments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`member_id` int NOT NULL,
	`amount` decimal(10,2) NOT NULL,
	`paid_on` date NOT NULL,
	`receipt_no` varchar(64),
	`note` varchar(255),
	`received_by` int,
	CONSTRAINT `payments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` varchar(64) NOT NULL,
	`value` json NOT NULL,
	CONSTRAINT `settings_key` PRIMARY KEY(`key`)
);
--> statement-breakpoint
CREATE TABLE `titles` (
	`id` int AUTO_INCREMENT NOT NULL,
	`title` varchar(500) NOT NULL,
	`authors` json NOT NULL,
	`subjects` json NOT NULL,
	`publisher` varchar(255),
	`place` varchar(128),
	`year` varchar(20),
	`edition` varchar(64),
	`isbn` varchar(32),
	`call_number` varchar(64),
	`classification` varchar(64),
	`language` varchar(64),
	`format_id` int,
	`notes` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `titles_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` int AUTO_INCREMENT NOT NULL,
	`username` varchar(64) NOT NULL,
	`name` varchar(128) NOT NULL,
	`password_hash` varchar(255) NOT NULL,
	`role` enum('admin','librarian','assistant') NOT NULL DEFAULT 'assistant',
	`active` boolean NOT NULL DEFAULT true,
	`last_login_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `users_username_unique` UNIQUE(`username`)
);
--> statement-breakpoint
CREATE TABLE `visits` (
	`id` int AUTO_INCREMENT NOT NULL,
	`member_id` int,
	`visitor_name` varchar(128) NOT NULL,
	`at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `visits_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `audit_log` ADD CONSTRAINT `audit_log_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `copies` ADD CONSTRAINT `copies_title_id_titles_id_fk` FOREIGN KEY (`title_id`) REFERENCES `titles`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `copies` ADD CONSTRAINT `copies_location_id_locations_id_fk` FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `copies` ADD CONSTRAINT `copies_collection_type_id_collection_types_id_fk` FOREIGN KEY (`collection_type_id`) REFERENCES `collection_types`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `fines` ADD CONSTRAINT `fines_member_id_members_id_fk` FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `fines` ADD CONSTRAINT `fines_loan_id_loans_id_fk` FOREIGN KEY (`loan_id`) REFERENCES `loans`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `fines` ADD CONSTRAINT `fines_waived_by_users_id_fk` FOREIGN KEY (`waived_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `loans` ADD CONSTRAINT `loans_copy_id_copies_id_fk` FOREIGN KEY (`copy_id`) REFERENCES `copies`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `loans` ADD CONSTRAINT `loans_member_id_members_id_fk` FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `loans` ADD CONSTRAINT `loans_issued_by_users_id_fk` FOREIGN KEY (`issued_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `loans` ADD CONSTRAINT `loans_returned_by_users_id_fk` FOREIGN KEY (`returned_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `members` ADD CONSTRAINT `members_type_id_member_types_id_fk` FOREIGN KEY (`type_id`) REFERENCES `member_types`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `payments` ADD CONSTRAINT `payments_member_id_members_id_fk` FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `payments` ADD CONSTRAINT `payments_received_by_users_id_fk` FOREIGN KEY (`received_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `titles` ADD CONSTRAINT `titles_format_id_formats_id_fk` FOREIGN KEY (`format_id`) REFERENCES `formats`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `visits` ADD CONSTRAINT `visits_member_id_members_id_fk` FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `audit_log_at_idx` ON `audit_log` (`at`);--> statement-breakpoint
CREATE INDEX `copies_title_idx` ON `copies` (`title_id`);--> statement-breakpoint
CREATE INDEX `loans_member_idx` ON `loans` (`member_id`);--> statement-breakpoint
CREATE INDEX `loans_due_idx` ON `loans` (`due_on`);--> statement-breakpoint
CREATE INDEX `members_name_idx` ON `members` (`name`);--> statement-breakpoint
CREATE INDEX `titles_isbn_idx` ON `titles` (`isbn`);--> statement-breakpoint
CREATE INDEX `titles_title_idx` ON `titles` (`title`);--> statement-breakpoint
CREATE INDEX `visits_at_idx` ON `visits` (`at`);