CREATE TABLE `accounts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`username` varchar(255) NOT NULL,
	`email` varchar(320) NOT NULL,
	`password` varchar(255) NOT NULL,
	`referrer` varchar(255),
	`status` enum('pendente','ativada','falhou') NOT NULL DEFAULT 'pendente',
	`createdAt` bigint NOT NULL,
	CONSTRAINT `accounts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `app_config` (
	`id` int AUTO_INCREMENT NOT NULL,
	`configKey` varchar(100) NOT NULL,
	`configValue` text NOT NULL,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `app_config_id` PRIMARY KEY(`id`),
	CONSTRAINT `app_config_configKey_unique` UNIQUE(`configKey`)
);
