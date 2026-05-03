const mongoose = require("mongoose");
const Comment = require("../models/Comment");

const toCommentDoc = (data) => ({
    source_stream_id: String(
        data.source_stream_id ??
        data.sourceStreamId ??
        (data.stream_key && data.stream_id ? `${data.stream_key}:${data.stream_id}` : "")
    ) || undefined,
    user_id: String(data.user_id ?? data.senderUserId ?? data.sender_user_id ?? data.sender ?? ""),
    sender_display_name: String(data.sender_display_name ?? data.senderDisplayName ?? data.sender ?? data.user_id ?? ""),
    room_owner_user_id: String(data.room_owner_user_id ?? data.roomOwnerUserId ?? ""),
    room_name: String(data.room_name ?? data.roomName ?? ""),
    comment: String(data.comment ?? data.message ?? ""),
    room_id: String(data.room_id ?? data.roomId ?? "0"),
    type: String(data.type ?? ""),
    isSuperChat: data.isSuperChat === true || data.isSuperChat === "true",
    msg_id: String(data.msg_id ?? data.msgId ?? ""),
    stream_id: String(data.stream_id ?? data.streamId ?? ""),
    stream_key: String(data.stream_key ?? data.streamKey ?? ""),
    createdAt: data.createdAt
        ? new Date(data.createdAt)
        : data.publishedAt
            ? new Date(Number(data.publishedAt))
            : new Date()
});

const saveComment = async (data) => {
    try {
        const comment = new Comment(toCommentDoc(data));

        await comment.save();
        console.log("Comment saved");
        return comment;
    } catch (err) {
        console.error("Comment save failed:", err);
        throw err;
    }
};

const saveCommentsBatch = async (items) => {
    const docs = items.map(toCommentDoc);

    if (docs.length === 0) {
        return [];
    }

    try {
        const result = await Comment.insertMany(docs, { ordered: false });
        console.log(`Comment batch saved: ${result.length}`);
        return result;
    } catch (err) {
        const writeErrors = err.writeErrors || err.result?.result?.writeErrors || [];
        const duplicateOnly = err.code === 11000 || (writeErrors.length > 0 && writeErrors.every((writeError) => {
            const code = writeError.code || writeError.err?.code;
            return code === 11000;
        }));

        if (!duplicateOnly) {
            throw err;
        }

        const insertedDocs = err.insertedDocs || [];
        console.warn(
            `Comment batch contained duplicates: inserted=${insertedDocs.length}, duplicates=${writeErrors.length}`
        );
        return insertedDocs;
    }
};

const buildRoomFilterAfterComment = (roomId, lastCommentId) => {
    const filter = {
        room_id: String(roomId),
        comment: { $ne: "" }
    };

    if (lastCommentId && mongoose.Types.ObjectId.isValid(lastCommentId)) {
        filter._id = { $gt: new mongoose.Types.ObjectId(lastCommentId) };
    }

    return filter;
};

const countCommentsAfterCommentId = async (roomId, lastCommentId) => {
    return Comment.countDocuments(buildRoomFilterAfterComment(roomId, lastCommentId));
};

const getLatestCommentsForRoom = async (roomId, limit) => {
    const safeLimit = Math.max(Number(limit) || 1, 1);

    return Comment.find({
        room_id: String(roomId),
        comment: { $ne: "" }
    })
        .sort({ _id: -1 })
        .limit(safeLimit)
        .lean();
};

const getRecentCommentsForRoom = async (roomId, { since, limit }) => {
    const safeLimit = Math.min(Math.max(Number(limit) || 1, 1), 100);
    const sinceDate = since instanceof Date ? since : new Date(since);

    return Comment.find({
        room_id: String(roomId),
        comment: { $ne: "" },
        createdAt: { $gte: sinceDate }
    })
        .sort({ createdAt: -1, _id: -1 })
        .limit(safeLimit)
        .lean();
};

module.exports = {
    saveComment,
    saveCommentsBatch,
    countCommentsAfterCommentId,
    getLatestCommentsForRoom,
    getRecentCommentsForRoom
};
