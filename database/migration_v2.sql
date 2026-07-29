-- ============================================================
--  FootSession Pro — Migration v2
--  Charge/intensité · Bibliothèque d'exercices · Thème club
--  Rôles cellule · Commentaires · Partage lecture seule
--  À importer une fois sur une base existante.
-- ============================================================
USE footsession_pro;

-- Feature 2 : charge & intensité (par procédé)
ALTER TABLE procedures ADD COLUMN IF NOT EXISTS intensite INT DEFAULT NULL;        -- RPE 1..10
ALTER TABLE procedures ADD COLUMN IF NOT EXISTS temps_recup_min INT DEFAULT NULL;  -- récupération (min)

-- Feature 3 : identité club
ALTER TABLE users ADD COLUMN IF NOT EXISTS club_logo LONGTEXT DEFAULT NULL;        -- PNG base64
ALTER TABLE users ADD COLUMN IF NOT EXISTS club_color VARCHAR(9) DEFAULT NULL;     -- couleur accent (hex)

-- Feature 10 : rôles cellule + partage
ALTER TABLE users MODIFY COLUMN role ENUM('admin','coach','analyste','prepa','viewer') DEFAULT 'coach';
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS share_token VARCHAR(40) DEFAULT NULL;

-- Feature 10 : commentaires de séance
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

-- Feature 1 : bibliothèque d'exercices (modèles réutilisables)
CREATE TABLE IF NOT EXISTS exercise_templates (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  user_id      INT NOT NULL,
  nom          VARCHAR(200) NOT NULL,
  categorie    VARCHAR(100),
  data         LONGTEXT,        -- champs du procédé (JSON)
  canvas_json  LONGTEXT,        -- schéma tactique lié (optionnel)
  canvas_image LONGTEXT,        -- miniature base64
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_templates_user (user_id),
  CONSTRAINT fk_templates_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
