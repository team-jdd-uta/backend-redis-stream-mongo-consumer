const Comment = require("../models/Comment");

const toCommentDoc = (data) => ({
    // Java producer(sender/message/roomId/publishedAt)와 기존 producer(user_id/comment/room_id/createdAt)를 모두 수용
    user_id: String(data.user_id ?? data.sender ?? ""),
    comment: String(data.comment ?? data.message ?? ""),
    room_id: String(data.room_id ?? data.roomId ?? "0"),
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
        console.log("댓글 저장 완료");
    } catch (err) {
        console.error("댓글 저장 실패:", err);
    }
};

const saveCommentsBatch = async (items) => {
    const docs = items.map(toCommentDoc);
    const result = await Comment.insertMany(docs, { ordered: false });
    console.log(`댓글 배치 저장 완료: ${result.length}건`);
    return result.length;
};

module.exports = { saveComment, saveCommentsBatch };
