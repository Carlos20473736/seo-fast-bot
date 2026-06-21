ALTER TABLE `accounts` ADD `createSeofast` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `accounts` ADD `seofastUsername` varchar(255);--> statement-breakpoint
ALTER TABLE `accounts` ADD `seofastPassword` varchar(255);--> statement-breakpoint
ALTER TABLE `accounts` ADD `seofastStatus` enum('pendente','ativada','falhou') DEFAULT 'pendente' NOT NULL;