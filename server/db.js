import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

export const DATA_DIR = process.env.DATA_DIR || join(process.cwd(), "data");
mkdirSync(DATA_DIR, { recursive: true });

export const db = new DatabaseSync(join(DATA_DIR, "lakar.sqlite"));

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    auth_hash TEXT NOT NULL,
    auth_salt TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS folders (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    enc_name TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS scenes (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL,
    enc_title TEXT NOT NULL,
    enc_data TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    size INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS satchel_items (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    enc_data TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS invites (
    code_hash TEXT PRIMARY KEY,
    created_at INTEGER NOT NULL,
    expires_at INTEGER,
    used_by TEXT,
    used_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS rooms (
    id TEXT PRIMARY KEY,
    mode TEXT NOT NULL,
    verifier_hash TEXT NOT NULL,
    owner_hash TEXT NOT NULL,
    enc_snapshot TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS published (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    scene_id TEXT,
    enc_data TEXT NOT NULL,
    size INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS key_wraps (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    slot TEXT NOT NULL DEFAULT '',
    wrapped TEXT NOT NULL,
    params TEXT NOT NULL DEFAULT '{}',
    label TEXT,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, kind, slot)
  );

  CREATE TABLE IF NOT EXISTS data_keys (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    epoch INTEGER NOT NULL,
    wrapped TEXT NOT NULL,
    dk_check TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, epoch)
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_wraps_credential ON key_wraps(slot) WHERE kind = 'passkey';
  CREATE INDEX IF NOT EXISTS idx_published_user ON published(user_id, updated_at DESC);
  CREATE INDEX IF NOT EXISTS idx_scenes_user ON scenes(user_id, updated_at DESC);
  CREATE INDEX IF NOT EXISTS idx_folders_user ON folders(user_id);
  CREATE INDEX IF NOT EXISTS idx_satchel_user ON satchel_items(user_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_rooms_updated ON rooms(updated_at);
`);

const addColumn = (table, column, definition) => {
  const exists = db
    .prepare(`PRAGMA table_info(${table})`)
    .all()
    .some((c) => c.name === column);
  if (!exists) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
};

addColumn("users", "token_version", "INTEGER NOT NULL DEFAULT 1");
addColumn("users", "write_epoch", "INTEGER NOT NULL DEFAULT 0");
addColumn("users", "ark_check", "TEXT");
addColumn("users", "recovery_hash", "TEXT");
addColumn("users", "recovery_salt", "TEXT");
addColumn("published", "enc_secret", "TEXT");

export const transaction = (fn) => {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (err) {
    try {
      db.exec("ROLLBACK");
    } catch {
    }
    throw err;
  }
};

export const stmts = {
  createUser: db.prepare(
    "INSERT INTO users (id, email, auth_hash, auth_salt, created_at) VALUES (?, ?, ?, ?, ?)",
  ),
  userByEmail: db.prepare("SELECT * FROM users WHERE email = ?"),
  userById: db.prepare("SELECT * FROM users WHERE id = ?"),
  deleteUser: db.prepare("DELETE FROM users WHERE id = ?"),

  setAuth: db.prepare(
    "UPDATE users SET auth_hash = ?, auth_salt = ?, token_version = token_version + 1 WHERE id = ?",
  ),
  setArkCheck: db.prepare(
    "UPDATE users SET ark_check = ? WHERE id = ? AND ark_check IS NULL",
  ),
  setWriteEpoch: db.prepare("UPDATE users SET write_epoch = ? WHERE id = ?"),
  setRecovery: db.prepare(
    "UPDATE users SET recovery_hash = ?, recovery_salt = ? WHERE id = ?",
  ),

  listWraps: db.prepare(
    `SELECT kind, slot, wrapped, params, label, created_at AS createdAt
     FROM key_wraps WHERE user_id = ?`,
  ),
  wrapByKind: db.prepare(
    "SELECT wrapped, params FROM key_wraps WHERE user_id = ? AND kind = ? AND slot = ?",
  ),
  wrapByCredential: db.prepare(
    `SELECT user_id AS userId, wrapped, params, label
     FROM key_wraps WHERE kind = 'passkey' AND slot = ?`,
  ),
  countWrapsOfKind: db.prepare(
    "SELECT COUNT(*) AS n FROM key_wraps WHERE user_id = ? AND kind = ?",
  ),
  putWrap: db.prepare(
    `INSERT INTO key_wraps (user_id, kind, slot, wrapped, params, label, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, kind, slot)
     DO UPDATE SET wrapped = excluded.wrapped, params = excluded.params,
                   label = excluded.label`,
  ),
  deleteWrap: db.prepare(
    "DELETE FROM key_wraps WHERE user_id = ? AND kind = ? AND slot = ?",
  ),

  bumpTokenVersion: db.prepare(
    "UPDATE users SET token_version = token_version + 1 WHERE id = ?",
  ),

  listDataKeys: db.prepare(
    `SELECT epoch, wrapped, dk_check AS dkCheck, created_at AS createdAt
     FROM data_keys WHERE user_id = ? ORDER BY epoch ASC`,
  ),
  dataKeyByEpoch: db.prepare(
    "SELECT wrapped, dk_check AS dkCheck FROM data_keys WHERE user_id = ? AND epoch = ?",
  ),
  putDataKey: db.prepare(
    `INSERT INTO data_keys (user_id, epoch, wrapped, dk_check, created_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(user_id, epoch) DO NOTHING`,
  ),

  listScenes: db.prepare(
    `SELECT id, folder_id AS folderId, enc_title AS encTitle, version, size,
            created_at AS createdAt, updated_at AS updatedAt
     FROM scenes WHERE user_id = ? ORDER BY updated_at DESC`,
  ),
  sceneById: db.prepare("SELECT * FROM scenes WHERE id = ? AND user_id = ?"),
  countScenes: db.prepare("SELECT COUNT(*) AS n FROM scenes WHERE user_id = ?"),
  sceneBytes: db.prepare(
    "SELECT COALESCE(SUM(size), 0) AS bytes FROM scenes WHERE user_id = ?",
  ),
  createScene: db.prepare(
    `INSERT INTO scenes (id, user_id, folder_id, enc_title, enc_data, version, size, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)`,
  ),
  updateScene: db.prepare(
    `UPDATE scenes SET enc_title = ?, enc_data = ?, folder_id = ?, version = version + 1,
            size = ?, updated_at = ?
     WHERE id = ? AND user_id = ?`,
  ),
  deleteScene: db.prepare("DELETE FROM scenes WHERE id = ? AND user_id = ?"),

  listFolders: db.prepare(
    "SELECT id, enc_name AS encName, created_at AS createdAt FROM folders WHERE user_id = ?",
  ),
  folderById: db.prepare("SELECT * FROM folders WHERE id = ? AND user_id = ?"),
  createFolder: db.prepare(
    "INSERT INTO folders (id, user_id, enc_name, created_at) VALUES (?, ?, ?, ?)",
  ),
  renameFolder: db.prepare(
    "UPDATE folders SET enc_name = ? WHERE id = ? AND user_id = ?",
  ),
  deleteFolder: db.prepare("DELETE FROM folders WHERE id = ? AND user_id = ?"),

  listSatchel: db.prepare(
    `SELECT id, enc_data AS encData, created_at AS createdAt
     FROM satchel_items WHERE user_id = ? ORDER BY created_at ASC`,
  ),
  countSatchel: db.prepare(
    "SELECT COUNT(*) AS n FROM satchel_items WHERE user_id = ?",
  ),
  createSatchelItem: db.prepare(
    "INSERT INTO satchel_items (id, user_id, enc_data, created_at) VALUES (?, ?, ?, ?)",
  ),
  deleteSatchelItem: db.prepare(
    "DELETE FROM satchel_items WHERE id = ? AND user_id = ?",
  ),

  listPublished: db.prepare(
    `SELECT id, scene_id AS sceneId, enc_secret AS encSecret, size,
            created_at AS createdAt, updated_at AS updatedAt
     FROM published WHERE user_id = ? ORDER BY updated_at DESC`,
  ),
  setPublishedSecret: db.prepare(
    "UPDATE published SET enc_secret = ? WHERE id = ? AND user_id = ?",
  ),
  publishedById: db.prepare(
    `SELECT enc_data AS encData, updated_at AS updatedAt
     FROM published WHERE id = ?`,
  ),
  publishedOwner: db.prepare(
    "SELECT id FROM published WHERE id = ? AND user_id = ?",
  ),
  publishedBySceneId: db.prepare(
    "SELECT id FROM published WHERE user_id = ? AND scene_id = ?",
  ),
  countPublished: db.prepare(
    "SELECT COUNT(*) AS n, COALESCE(SUM(size), 0) AS bytes FROM published WHERE user_id = ?",
  ),
  createPublished: db.prepare(
    `INSERT INTO published (id, user_id, scene_id, enc_data, enc_secret, size, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ),
  updatePublished: db.prepare(
    `UPDATE published SET enc_data = ?, size = ?, updated_at = ?
     WHERE id = ? AND user_id = ?`,
  ),
  deletePublished: db.prepare(
    "DELETE FROM published WHERE id = ? AND user_id = ?",
  ),

  inviteByHash: db.prepare(
    `SELECT code_hash AS codeHash, expires_at AS expiresAt, used_by AS usedBy
     FROM invites WHERE code_hash = ?`,
  ),
  createInvite: db.prepare(
    "INSERT INTO invites (code_hash, created_at, expires_at) VALUES (?, ?, ?)",
  ),
  useInvite: db.prepare(
    "UPDATE invites SET used_by = ?, used_at = ? WHERE code_hash = ? AND used_by IS NULL",
  ),
  listInvites: db.prepare(
    `SELECT i.code_hash AS codeHash, i.created_at AS createdAt,
            i.expires_at AS expiresAt, i.used_at AS usedAt, u.email AS usedByEmail
     FROM invites i LEFT JOIN users u ON u.id = i.used_by
     ORDER BY i.created_at DESC`,
  ),

  roomById: db.prepare("SELECT * FROM rooms WHERE id = ?"),
  createRoom: db.prepare(
    `INSERT INTO rooms (id, mode, verifier_hash, owner_hash, enc_snapshot, created_at, updated_at)
     VALUES (?, ?, ?, ?, NULL, ?, ?)`,
  ),
  touchRoom: db.prepare("UPDATE rooms SET updated_at = ? WHERE id = ?"),
  saveRoomSnapshot: db.prepare(
    "UPDATE rooms SET enc_snapshot = ?, updated_at = ? WHERE id = ?",
  ),
  deleteRoom: db.prepare("DELETE FROM rooms WHERE id = ?"),
  pruneRooms: db.prepare("DELETE FROM rooms WHERE updated_at < ?"),
  countRooms: db.prepare("SELECT COUNT(*) AS n FROM rooms"),
};
