const { getMariaDbPool } = require('../config/mariadb');

function toDate(value) {
  if (!value) {
    return new Date();
  }
  if (typeof value === 'number') {
    return new Date(value);
  }
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    return new Date(Number(value));
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function normalizeProjectionItem(record) {
  const data = record?.data || record || {};
  const meta = record?.meta || {};
  const createdAt = toDate(data.createdAt || data.publishedAt || meta.createdAt);

  return {
    sourceStreamId: String(meta.sourceStreamId || data.sourceStreamId || ''),
    ownerUserId: String(data.roomOwnerUserId || data.ownerUserId || data.owner_user_id || ''),
    roomId: String(data.roomId || data.room_id || ''),
    roomName: String(data.roomName || data.room_name || ''),
    senderUserId: String(data.senderUserId || data.user_id || data.sender_user_id || data.sender || ''),
    senderDisplayName: String(data.sender || data.senderDisplayName || data.user_id || data.sender_user_id || ''),
    message: String(data.message || data.comment || ''),
    createdAt,
  };
}

async function saveChatHistoryBatch(items) {
  const rows = items
    .map(normalizeProjectionItem)
    .filter((item) => item.sourceStreamId && item.ownerUserId && item.roomId && item.senderUserId && item.message);

  if (rows.length === 0) {
    return 0;
  }

  const pool = getMariaDbPool();
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    for (const row of rows) {
      await connection.execute(
        `
          INSERT INTO chat_message_projection
            (source_stream_id, owner_user_id, room_id, room_name, sender_user_id, sender_display_name, message, created_at)
          VALUES
            (?, ?, ?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            owner_user_id = VALUES(owner_user_id),
            room_id = VALUES(room_id),
            room_name = VALUES(room_name),
            sender_user_id = VALUES(sender_user_id),
            sender_display_name = VALUES(sender_display_name),
            message = VALUES(message),
            created_at = VALUES(created_at)
        `,
        [
          row.sourceStreamId,
          row.ownerUserId,
          row.roomId,
          row.roomName || null,
          row.senderUserId,
          row.senderDisplayName,
          row.message,
          row.createdAt,
        ]
      );
    }

    await connection.commit();
    return rows.length;
  } catch (error) {
    await connection.rollback().catch(() => undefined);
    throw error;
  } finally {
    connection.release();
  }
}

function encodeCursor(createdAt, id) {
  return Buffer.from(JSON.stringify({ createdAt, id })).toString('base64url');
}

function decodeCursor(cursor) {
  if (!cursor) {
    return null;
  }
  try {
    const decoded = Buffer.from(String(cursor), 'base64url').toString('utf8');
    const parsed = JSON.parse(decoded);
    if (!parsed?.createdAt || !parsed?.id) {
      return null;
    }
    return {
      createdAt: new Date(parsed.createdAt),
      id: Number(parsed.id),
    };
  } catch (error) {
    return null;
  }
}

function sanitizeLimit(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 50;
  }
  return Math.min(Math.max(Math.trunc(parsed), 1), 100);
}

async function queryChatHistory({ ownerUserId, targetUserId, before, limit }) {
  const pool = getMariaDbPool();
  const pageSize = sanitizeLimit(limit);
  const cursor = decodeCursor(before);

  const params = [ownerUserId, targetUserId];
  let cursorClause = '';

  if (cursor) {
    cursorClause = 'AND (created_at < ? OR (created_at = ? AND id < ?))';
    params.push(cursor.createdAt, cursor.createdAt, cursor.id);
  }

  params.push(pageSize + 1);

  const [rows] = await pool.execute(
    `
      SELECT
        id,
        source_stream_id AS sourceStreamId,
        owner_user_id AS ownerUserId,
        room_id AS roomId,
        room_name AS roomName,
        sender_user_id AS senderUserId,
        sender_display_name AS senderDisplayName,
        message,
        created_at AS createdAt
      FROM chat_message_projection
      WHERE owner_user_id = ?
        AND sender_user_id = ?
        ${cursorClause}
      ORDER BY created_at DESC, id DESC
      LIMIT ?
    `,
    params
  );

  const hasMore = rows.length > pageSize;
  const limited = hasMore ? rows.slice(0, pageSize) : rows;
  const items = limited
    .slice()
    .reverse()
    .map((row) => ({
      id: row.id,
      sourceStreamId: row.sourceStreamId,
      ownerUserId: row.ownerUserId,
      targetUserId: row.senderUserId,
      roomId: row.roomId,
      roomName: row.roomName,
      senderUserId: row.senderUserId,
      senderDisplayName: row.senderDisplayName,
      message: row.message,
      createdAt: row.createdAt,
    }));

  const oldest = items[0];
  return {
    ownerUserId,
    targetUserId,
    limit: pageSize,
    hasMore,
    nextCursor: hasMore && oldest ? encodeCursor(oldest.createdAt, oldest.id) : null,
    items,
  };
}

module.exports = {
  saveChatHistoryBatch,
  queryChatHistory,
  encodeCursor,
  decodeCursor,
  sanitizeLimit,
};
