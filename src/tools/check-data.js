const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env") });
const mongoose = require("mongoose");
const Comment = require("../models/Comment");

const checkData = async () => {
    try {
        if (!process.env.MONGO_URI) {
            throw new Error("MONGO_URI is missing. Check .env in project root.");
        }

        await mongoose.connect(process.env.MONGO_URI);
        console.log("✅ MongoDB 연결 성공\n");

        const count = await Comment.countDocuments();
        console.log(`📊 총 Comment 개수: ${count}\n`);
    } catch (err) {
        console.error("❌ 오류:", err.message);
    } finally {
        await mongoose.disconnect();
    }
};

checkData();
