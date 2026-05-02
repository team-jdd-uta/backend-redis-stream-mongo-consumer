const Comment = require('../models/Comment');
const { saveChatHistoryBatch } = require('./chatHistoryProjectionService');

const toCommentDoc = (record) => {
  const data = record?.data || record || {};
  const meta = record?.meta || {};

  return {
    source_stream_id: String(meta.sourceStreamId || data.sourceStreamId || ''),
    user_id: String(data.senderUserId ?? data.user_id ?? data.sender ?? ''),
    sender_display_name: String(data.sender ?? data.senderDisplayName ?? data.user_id ?? ''),
    room_owner_user_id: String(data.roomOwnerUserId ?? data.ownerUserId ?? data.room_owner_user_id ?? ''),
    room_name: String(data.roomName ?? data.room_name ?? ''),
    comment: String(data.comment ?? data.message ?? ''),
    room_id: String(data.room_id ?? data.roomId ?? '0'),
    createdAt: data.createdAt
      ? new Date(data.createdAt)
      : data.publishedAt
        ? new Date(Number(data.publishedAt))
        : new Date(),
  };
};

const saveComment = async (record) => {
  try {
    const comment = new Comment(toCommentDoc(record));

    await comment.save();
    console.log('댓글 저장 완료');
  } catch (err) {
    console.error('댓글 저장 실패:', err);
    throw err;
  }
};

const saveCommentsBatch = async (items) => {
  const docs = items.map(toCommentDoc);
  const commentOps = docs
    .filter((doc) => doc.source_stream_id)
    .map((doc) => ({
      updateOne: {
        filter: { source_stream_id: doc.source_stream_id },
        update: { $setOnInsert: doc },
        upsert: true,
      },
    }));

  if (commentOps.length > 0) {
    const result = await Comment.bulkWrite(commentOps, { ordered: false });
    console.log(`댓글 배치 저장 완료: ${result.upsertedCount || 0}건`);
  } else {
    console.log('댓글 배치 저장 건수 0건');
  }

  const projected = await saveChatHistoryBatch(items);
  console.log(`채팅 조회용 projection 저장 완료: ${projected}건`);
  return projected;
};

module.exports = { saveComment, saveCommentsBatch };
