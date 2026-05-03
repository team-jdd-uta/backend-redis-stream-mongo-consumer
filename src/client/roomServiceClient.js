const axios = require("axios");

const ROOM_SERVICE_URL = process.env.ROOM_SERVICE_URL || "http://localhost:8082";
const ROOM_SERVICE_TIMEOUT_MS = Number(process.env.ROOM_SERVICE_TIMEOUT_MS || 3000);

function createRoomServiceClient() {
    const http = axios.create({
        baseURL: ROOM_SERVICE_URL,
        timeout: ROOM_SERVICE_TIMEOUT_MS
    });

    return {
        async getRoom(roomId) {
            const response = await http.get(`/rooms/${encodeURIComponent(roomId)}`);
            return response.data || {};
        }
    };
}

module.exports = {
    createRoomServiceClient
};
