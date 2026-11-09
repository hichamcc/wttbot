-- Tables owned by the WhatsApp bot. Everything else in the WTT database is read-only for the bot.

-- Manual phone links: drivers whose phone is missing/wrong in Mapon, and office staff.
-- phone must be E.164, e.g. +4512345678.
CREATE TABLE IF NOT EXISTS wa_phone_overrides (
  phone        VARCHAR(20)  NOT NULL PRIMARY KEY,
  display_name VARCHAR(100) NULL,
  bil          VARCHAR(50)  NULL COMMENT 'Truck plate as stored in delivery.bil; NULL for staff without a default truck',
  is_staff     TINYINT(1)   NOT NULL DEFAULT 0 COMMENT 'Staff may ask about any truck',
  active       TINYINT(1)   NOT NULL DEFAULT 1,
  note         VARCHAR(255) NULL,
  created_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Conversation memory, so follow-up questions ("and the second stop?") work.
CREATE TABLE IF NOT EXISTS wa_messages (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  chat_jid   VARCHAR(100) NOT NULL,
  phone      VARCHAR(20)  NOT NULL,
  role       ENUM('user', 'model') NOT NULL,
  text       TEXT         NOT NULL,
  cleared    TINYINT(1)   NOT NULL DEFAULT 0,
  created_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_chat_phone (chat_jid, phone, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- One row per /bot request, for reviewing answer quality and cost during the pilot.
CREATE TABLE IF NOT EXISTS wa_logs (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  chat_jid   VARCHAR(100) NOT NULL,
  phone      VARCHAR(20)  NULL,
  is_group   TINYINT(1)   NOT NULL DEFAULT 0,
  bil        VARCHAR(50)  NULL,
  question   TEXT         NOT NULL,
  answer     TEXT         NULL,
  tool_calls JSON         NULL,
  tokens_in  INT          NULL,
  tokens_out INT          NULL,
  latency_ms INT          NULL,
  error      VARCHAR(1000) NULL,
  created_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_created (created_at),
  KEY idx_phone (phone)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Bot database user: read-only on WTT tables, read/write only on its own wa_* tables.
-- Replace the password and run as a MySQL admin.
--
-- CREATE USER 'wtt_bot'@'localhost' IDENTIFIED BY 'change-me';
-- GRANT SELECT ON h762997_wttsystemdk.delivery               TO 'wtt_bot'@'localhost';
-- GRANT SELECT ON h762997_wttsystemdk.delivery_places        TO 'wtt_bot'@'localhost';
-- GRANT SELECT ON h762997_wttsystemdk.delivery_extra_places  TO 'wtt_bot'@'localhost';
-- GRANT SELECT ON h762997_wttsystemdk.attachments            TO 'wtt_bot'@'localhost';
-- GRANT SELECT ON h762997_wttsystemdk.user                   TO 'wtt_bot'@'localhost';
-- GRANT SELECT, INSERT, UPDATE ON h762997_wttsystemdk.wa_phone_overrides TO 'wtt_bot'@'localhost';
-- GRANT SELECT, INSERT, UPDATE ON h762997_wttsystemdk.wa_messages        TO 'wtt_bot'@'localhost';
-- GRANT SELECT, INSERT         ON h762997_wttsystemdk.wa_logs            TO 'wtt_bot'@'localhost';
