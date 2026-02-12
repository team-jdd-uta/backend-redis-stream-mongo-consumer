const mongoose = require("mongoose");

const commentSchema = new mongoose.Schema(
    {
        user_id: String,
        comment: String,
        room_id: String,
        createdAt: Date,
    }
);

module.exports = mongoose.model("Comment", commentSchema);