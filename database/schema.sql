-- ============================================================
--  FootSession Pro — Schéma MySQL
--  À importer dans phpMyAdmin (onglet "Importer") ou via :
--    mysql -u root < database/schema.sql
-- ============================================================

CREATE DATABASE IF NOT EXISTS footsession_pro
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

USE footsession_pro;

-- ------------------------------------------------------------
--  UTILISATEURS
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  nom              VARCHAR(100) NOT NULL,
  email            VARCHAR(150) UNIQUE NOT NULL,
  password_hash    VARCHAR(255) NOT NULL,
  role             ENUM('admin','coach','analyste','prepa','viewer') DEFAULT 'coach',
  club_logo        LONGTEXT,
  club_color       VARCHAR(9),
  club             VARCHAR(100),
  avatar_initiales VARCHAR(3),
  actif            TINYINT(1) DEFAULT 1,
  created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
--  SÉANCES
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sessions (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  user_id     INT NOT NULL,
  titre       VARCHAR(200) NOT NULL,
  date_seance DATE NOT NULL,
  categorie   VARCHAR(100),
  equipe      VARCHAR(50),
  duree_min   INT DEFAULT 90,
  notes       TEXT,
  share_token VARCHAR(40) DEFAULT NULL,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_sessions_user (user_id),
  KEY idx_sessions_date (date_seance),
  CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
--  PROCÉDÉS (étapes d'une séance)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS procedures (
  id                        INT AUTO_INCREMENT PRIMARY KEY,
  session_id                INT NOT NULL,
  ordre                     INT DEFAULT 1,
  nom                       VARCHAR(200) NOT NULL,
  duree_min                 INT DEFAULT 20,
  objectif                  TEXT,
  effectif                  VARCHAR(100),
  postes_cibles             VARCHAR(200),
  zones_jeu                 VARCHAR(200),
  taille_terrain            VARCHAR(100),
  consignes                 TEXT,
  principes_jeu             TEXT,
  comportements_individuels TEXT,
  intensite                 INT DEFAULT NULL,
  temps_recup_min           INT DEFAULT NULL,
  created_at                TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_procedures_session (session_id),
  KEY idx_procedures_ordre (session_id, ordre),
  CONSTRAINT fk_procedures_session FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
--  SCHÉMAS TACTIQUES
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tactical_schemas (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  procedure_id INT NOT NULL,
  canvas_json  LONGTEXT,       -- objets placés sur le terrain (sérialisés)
  canvas_image LONGTEXT,       -- PNG base64 pour l'export PDF
  vue_terrain  VARCHAR(50) DEFAULT 'complet',
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_schema_procedure (procedure_id),
  CONSTRAINT fk_schema_procedure FOREIGN KEY (procedure_id) REFERENCES procedures(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
--  JOUEURS
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS players (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  user_id    INT NOT NULL,
  nom        VARCHAR(100) NOT NULL,
  prenom     VARCHAR(100),
  numero     INT,
  poste      VARCHAR(50),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_players_user (user_id),
  CONSTRAINT fk_players_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
--  PRÉSENCES
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS attendance (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  player_id  INT NOT NULL,
  session_id INT NOT NULL,
  present    TINYINT(1) DEFAULT 0,
  UNIQUE KEY unique_presence (player_id, session_id),
  KEY idx_attendance_session (session_id),
  CONSTRAINT fk_attendance_player  FOREIGN KEY (player_id)  REFERENCES players(id)  ON DELETE CASCADE,
  CONSTRAINT fk_attendance_session FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
--  COMMENTAIRES DE SÉANCE (cellule)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS session_comments (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  session_id INT NOT NULL,
  user_id    INT,
  author     VARCHAR(120),
  body       TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_comments_session (session_id),
  CONSTRAINT fk_comments_session FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  CONSTRAINT fk_comments_user    FOREIGN KEY (user_id)    REFERENCES users(id)    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
--  BIBLIOTHÈQUE D'EXERCICES (modèles réutilisables)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS exercise_templates (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  user_id      INT NOT NULL,
  nom          VARCHAR(200) NOT NULL,
  categorie    VARCHAR(100),
  data         LONGTEXT,
  canvas_json  LONGTEXT,
  canvas_image LONGTEXT,
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_templates_user (user_id),
  CONSTRAINT fk_templates_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
