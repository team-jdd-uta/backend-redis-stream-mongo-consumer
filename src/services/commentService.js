const Comment = require("../models/Comment");

const toCommentDoc = (data) => ({
    user_id: String(data.user_id ?? ""),
    comment: String(data.comment ?? ""),
    room_id: String(data.room_id ?? "0"),
    createdAt: data.createdAt ? new Date(data.createdAt) : new Date()
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
