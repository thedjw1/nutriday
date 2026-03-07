-- AI Health MySQL initialization
-- Run on server:
--   mysql -u aihealth -p ai_health < init_ai_health.sql

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(64) PRIMARY KEY,
  email VARCHAR(255) NOT NULL,
  display_name VARCHAR(128) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  current_member_id VARCHAR(64) NULL,
  UNIQUE KEY uniq_users_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS auth_sessions (
  token VARCHAR(96) PRIMARY KEY,
  user_id VARCHAR(64) NOT NULL,
  email VARCHAR(255) NOT NULL,
  display_name VARCHAR(128) NOT NULL,
  mode VARCHAR(32) NOT NULL DEFAULT 'connectedCloud',
  is_demo TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_sessions_user_created (user_id, created_at),
  CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS members (
  id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(64) NOT NULL,
  name VARCHAR(128) NOT NULL,
  avatar TEXT NULL,
  relation VARCHAR(32) NOT NULL DEFAULT 'self',
  birth_date DATETIME NULL,
  gender VARCHAR(32) NULL,
  height DOUBLE NULL,
  weight DOUBLE NULL,
  blood_type VARCHAR(16) NULL,
  allergies_json JSON NOT NULL,
  chronic_diseases_json JSON NOT NULL,
  medications_json JSON NOT NULL,
  is_managed TINYINT(1) NOT NULL DEFAULT 0,
  manager_id VARCHAR(64) NULL,
  extra TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_members_user_updated (user_id, updated_at),
  CONSTRAINT fk_members_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS device_bindings (
  id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(64) NOT NULL,
  member_id VARCHAR(64) NULL,
  device_name VARCHAR(128) NOT NULL,
  device_type VARCHAR(64) NOT NULL,
  mac_address VARCHAR(32) NULL,
  is_connected TINYINT(1) NOT NULL DEFAULT 1,
  last_sync DATETIME NULL,
  last_data JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_device_user_sync (user_id, last_sync)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS supplement_box_bindings (
  id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(64) NOT NULL,
  member_id VARCHAR(64) NOT NULL,
  box_slot VARCHAR(8) NOT NULL,
  supplement_name VARCHAR(255) NOT NULL,
  gram_per_unit DOUBLE NOT NULL DEFAULT 0,
  image_url TEXT NULL,
  recognized_text TEXT NULL,
  confidence DOUBLE NOT NULL DEFAULT 0,
  nutrients_json JSON NOT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_box_binding_slot (user_id, member_id, box_slot),
  KEY idx_box_binding_member_updated (user_id, member_id, updated_at),
  CONSTRAINT fk_box_bindings_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS health_data_log (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id VARCHAR(64) NOT NULL,
  payload JSON NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_health_log_user_created (user_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS health_snapshots (
  id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(64) NOT NULL,
  member_id VARCHAR(64) NOT NULL,
  provider VARCHAR(64) NOT NULL,
  metric_type VARCHAR(64) NOT NULL,
  priority VARCHAR(16) NOT NULL,
  source_id VARCHAR(128) NULL,
  normalized_data JSON NOT NULL,
  raw_payload JSON NOT NULL,
  collected_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_snapshots_member_collected (user_id, member_id, collected_at),
  KEY idx_snapshots_provider_metric (provider, metric_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS generated_plans (
  id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(64) NOT NULL,
  member_id VARCHAR(64) NOT NULL,
  source VARCHAR(64) NOT NULL,
  calorie_target DOUBLE NOT NULL,
  slot_amounts JSON NOT NULL,
  plan_payload JSON NULL,
  summary TEXT NOT NULL,
  generated_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_plans_member_generated (user_id, member_id, generated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS analysis_records (
  id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(64) NOT NULL,
  record_type VARCHAR(32) NOT NULL,
  payload JSON NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_analysis_user_type_created (user_id, record_type, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sync_events (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id VARCHAR(64) NOT NULL,
  event_type VARCHAR(32) NOT NULL,
  source_id VARCHAR(128) NULL,
  payload JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_sync_events_user_created (user_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS member_cloud_state (
  user_id VARCHAR(64) NOT NULL,
  member_id VARCHAR(64) NOT NULL,
  payload JSON NOT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, member_id),
  KEY idx_member_cloud_state_updated (user_id, updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Column backfill for older schemas is handled by backend-example/server_complete.js
-- to remain compatible with MySQL versions that do not support
-- ALTER TABLE ... ADD COLUMN IF NOT EXISTS.
