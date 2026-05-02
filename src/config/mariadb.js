const mysql = require('mysql2/promise');

let pool;

function toNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getPoolConfig() {
  if (process.env.MARIADB_URL) {
    const url = new URL(process.env.MARIADB_URL);
    return {
      host: url.hostname,
      port: toNumber(url.port, 3306),
      user: decodeURIComponent(url.username || process.env.MARIADB_USER || 'root'),
      password: decodeURIComponent(url.password || process.env.MARIADB_PASSWORD || ''),
      database: url.pathname.replace(/^\//, '') || process.env.MARIADB_DATABASE || 'chat_history',
      waitForConnections: true,
      connectionLimit: toNumber(process.env.MARIADB_CONNECTION_LIMIT, 10),
      queueLimit: 0,
      charset: 'utf8mb4',
    };
  }

  return {
    host: process.env.MARIADB_HOST || process.env.DB_HOST || '127.0.0.1',
    port: toNumber(process.env.MARIADB_PORT || process.env.DB_PORT, 3306),
    user: process.env.MARIADB_USER || process.env.DB_USER || 'root',
    password: process.env.MARIADB_PASSWORD || process.env.DB_PASSWORD || '',
    database: process.env.MARIADB_DATABASE || process.env.DB_NAME || 'chat_history',
    waitForConnections: true,
    connectionLimit: toNumber(process.env.MARIADB_CONNECTION_LIMIT, 10),
    queueLimit: 0,
    charset: 'utf8mb4',
  };
}

async function initMariaDb() {
  if (!pool) {
    pool = mysql.createPool(getPoolConfig());
  }
  return pool;
}

async function ensureChatHistorySchema() {
  const activePool = await initMariaDb();
  await activePool.execute(`
    CREATE TABLE IF NOT EXISTS chat_message_projection (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      source_stream_id VARCHAR(128) NOT NULL,
      owner_user_id VARCHAR(128) NOT NULL,
      room_id VARCHAR(128) NOT NULL,
      room_name VARCHAR(255) DEFAULT NULL,
      sender_user_id VARCHAR(128) NOT NULL,
      sender_display_name VARCHAR(255) NOT NULL,
      message TEXT NOT NULL,
      created_at DATETIME(3) NOT NULL,
      processed_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (id),
      UNIQUE KEY uk_chat_message_projection_source_stream_id (source_stream_id),
      KEY idx_owner_sender_created_id (owner_user_id, sender_user_id, created_at DESC, id DESC),
      KEY idx_owner_room_created_id (owner_user_id, room_id, created_at DESC, id DESC)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

function getMariaDbPool() {
  if (!pool) {
    throw new Error('MariaDB pool is not initialized');
  }
  return pool;
}

async function closeMariaDb() {
  if (!pool) {
    return;
  }
  await pool.end();
  pool = undefined;
}

module.exports = {
  initMariaDb,
  ensureChatHistorySchema,
  getMariaDbPool,
  closeMariaDb,
};
