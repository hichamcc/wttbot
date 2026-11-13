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
  model      VARCHAR(64)  NULL,
  tokens_in  INT          NULL,
  tokens_out INT          NULL,
  latency_ms INT          NULL,
  error      VARCHAR(1000) NULL,
  created_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_created (created_at),
  KEY idx_phone (phone)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Settings edited from the admin dashboard (admin/whatsapp_bot/settings.php).
-- A missing row means "use the .env default".
CREATE TABLE IF NOT EXISTS wa_settings (
  name       VARCHAR(64)  NOT NULL PRIMARY KEY,
  value      TEXT         NULL,
  updated_by VARCHAR(100) NULL,
  updated_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Single row (id = 1) written by the bot: connection state, QR code for linking, heartbeat.
CREATE TABLE IF NOT EXISTS wa_status (
  id            TINYINT UNSIGNED NOT NULL PRIMARY KEY,
  state         VARCHAR(20)  NOT NULL,
  phone         VARCHAR(20)  NULL,
  qr            TEXT         NULL,
  version       VARCHAR(20)  NULL,
  settings_json TEXT         NULL COMMENT 'Effective settings the bot is using right now',
  started_at    TIMESTAMP    NULL,
  last_seen     TIMESTAMP    NULL
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
-- GRANT SELECT                 ON h762997_wttsystemdk.wa_settings        TO 'wtt_bot'@'localhost';
-- GRANT SELECT, INSERT, UPDATE ON h762997_wttsystemdk.wa_status          TO 'wtt_bot'@'localhost';
