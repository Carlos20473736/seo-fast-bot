CREATE TABLE `account_progress` (
	`id` int AUTO_INCREMENT NOT NULL,
	`sessionId` varchar(64) NOT NULL,
	`email` varchar(320) NOT NULL,
	`password` varchar(255) NOT NULL,
	`username` varchar(255),
	`currentStep` enum('captcha_pending','registration_pending','registration_done','verification_pending','activation_pending','wallet_pending','completed','failed') NOT NULL DEFAULT 'captcha_pending',
	`formData` text,
	`cookies` text,
	`tokens` text,
	`headersUsed` text,
	`ipAddress` varchar(45),
	`countryCode` varchar(5),
	`errorMessage` text,
	`errorStep` varchar(50),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`completedAt` timestamp,
	`accountId` int,
	CONSTRAINT `account_progress_id` PRIMARY KEY(`id`),
	CONSTRAINT `account_progress_sessionId_unique` UNIQUE(`sessionId`)
);
--> statement-breakpoint
CREATE TABLE `accounts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`username` varchar(255) NOT NULL,
	`email` varchar(320) NOT NULL,
	`password` varchar(255) NOT NULL,
	`referrer` varchar(255),
	`status` enum('pendente','ativada','falhou') NOT NULL DEFAULT 'pendente',
	`createdAt` bigint NOT NULL,
	`createSeofast` int NOT NULL DEFAULT 0,
	`seofastUsername` varchar(255),
	`seofastPassword` varchar(255),
	`seofastStatus` enum('pendente','ativada','falhou') NOT NULL DEFAULT 'pendente',
	`seofastCookies` text,
	`seofastDeviceId` varchar(255),
	`seofastProfile` text,
	`seofastHashAjax` varchar(255),
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
