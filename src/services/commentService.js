const mongoose = require("mongoose");
const Comment = require("../models/Comment");

const parseJsonObject = (value) => {
    if (typeof value !== "string") {
        return null;
    }

    try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
    } catch {
        return null;
    }
};

const normalizeSourceData = (data = {}) => {
    const payload = parseJsonObject(data.payload);
    const nestedMessage = parseJsonObject(data.message);

    return {
        ...data,
        ...(payload || {}),
        ...(nestedMessage || {})
    };
};

const getStreamRoomId = (streamKey) => {
    const value = String(streamKey || "");
    const match = value.match(/^chat:stream:room:(.+)$/);
    return match ? match[1] : "";
};

const buildRoomIdentityFilter = (roomId) => {
    const normalizedRoomId = String(roomId);

    return {
        $or: [
            { room_id: normalizedRoomId },
            { stream_key: `chat:stream:room:${normalizedRoomId}` }
        ]
    };
};

const describeCommentDoc = (doc) => ({
    room_id: doc.room_id,
    stream_key: doc.stream_key,
    source_stream_id: doc.source_stream_id,
    user_id: doc.user_id,
    commentLength: doc.comment.length,
    createdAt: doc.createdAt
});

const toCommentDoc = (sourceData) => {
    const data = normalizeSourceData(sourceData);
    const roomId = data.room_id ?? data.roomId ?? getStreamRoomId(data.stream_key ?? data.streamKey) ?? "0";

    return {
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
        room_id: String(roomId || "0"),
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
    };
};

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
        console.log("[comments:save] skipped empty batch");
        return [];
    }

    try {
        console.log(
            `[comments:save:start] docs=${docs.length}, rooms=${Array.from(new Set(docs.map((doc) => doc.room_id))).join(",")}`
        );
        console.log("[comments:save:sample]", describeCommentDoc(docs[0]));
        const result = await Comment.insertMany(docs, { ordered: false });
        console.log(`Comment batch saved: ${result.length}`);
        console.log(
            `[comments:save:done] inserted=${result.length}, rooms=${Array.from(new Set(result.map((doc) => doc.room_id))).join(",")}`
        );
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
        if (insertedDocs.length > 0) {
            console.log("[comments:save:duplicate-sample]", describeCommentDoc(insertedDocs[0]));
        }
        return insertedDocs;
    }
};

const buildRoomFilterAfterComment = (roomId, lastCommentId) => {
    const filter = {
        ...buildRoomIdentityFilter(roomId),
        comment: { $ne: "" }
    };

    if (lastCommentId && mongoose.Types.ObjectId.isValid(lastCommentId)) {
        filter._id = { $gt: new mongoose.Types.ObjectId(lastCommentId) };
    }

    return filter;
};

const countCommentsAfterCommentId = async (roomId, lastCommentId) => {
    const filter = buildRoomFilterAfterComment(roomId, lastCommentId);
    const count = await Comment.countDocuments(filter);
    console.log(`[comments:count-after] room_id=${roomId}, lastCommentId=${lastCommentId || ""}, count=${count}`);
    return count;
};

const getLatestCommentsForRoom = async (roomId, limit) => {
    const safeLimit = Math.max(Number(limit) || 1, 1);

    console.log(`[comments:latest:query] room_id=${roomId}, limit=${safeLimit}`);
    const comments = await Comment.find({
        ...buildRoomIdentityFilter(roomId),
        comment: { $ne: "" }
    })
        .sort({ _id: -1 })
        .limit(safeLimit)
        .lean();
    console.log(`[comments:latest:result] room_id=${roomId}, count=${comments.length}`);
    return comments;
};

const getRecentCommentsForRoom = async (roomId, { since, limit }) => {
    const safeLimit = Math.min(Math.max(Number(limit) || 1, 1), 100);
    const sinceDate = since instanceof Date ? since : new Date(since);

    console.log(`[comments:recent:query] room_id=${roomId}, since=${sinceDate.toISOString()}, limit=${safeLimit}`);
    const comments = await Comment.find({
        ...buildRoomIdentityFilter(roomId),
        comment: { $ne: "" },
        createdAt: { $gte: sinceDate }
    })
        .sort({ createdAt: -1, _id: -1 })
        .limit(safeLimit)
        .lean();
    console.log(`[comments:recent:result] room_id=${roomId}, count=${comments.length}`);
    if (comments.length > 0) {
        console.log("[comments:recent:sample]", describeCommentDoc(comments[0]));
    }
    return comments;
};

module.exports = {
    saveComment,
    saveCommentsBatch,
    countCommentsAfterCommentId,
    getLatestCommentsForRoom,
    getRecentCommentsForRoom
};
