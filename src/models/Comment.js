const mongoose = require("mongoose");

const commentSchema = new mongoose.Schema(
    {
        user_id: String,
        comment: String,
        room_id: { type: String, index: true },
        type: String,
        isSuperChat: { type: Boolean, default: false },
        msg_id: String,
        stream_id: String,
        stream_key: String,
        createdAt: { type: Date, default: Date.now, index: true },
    }
);

commentSchema.index({ room_id: 1, _id: -1 });

module.exports = mongoose.model("Comment", commentSchema);
