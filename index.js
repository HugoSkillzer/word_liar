const express = require("express");
const app = express();
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

app.use(cors());

const reg = /^[0-9]*$/;
const port = process.env.PORT || 3001;

const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: '*'
    }
});

io.on("connection", (socket) => {

    socket.on("join_room", (data) => {
        if(socket.rooms.size == 2) {
            socket.leave(Array.from(socket.rooms)[1]);
        }
        socket.join(data);
        io.to(data).emit("room_response", data);
        io.to(getBoss(data)).emit("boss_notified", `Boss`);
        let rooms = getRooms(io);
        rooms.forEach(room => {
            io.in(room).emit("clients_count", io.sockets.adapter.rooms.get(room).size);
        });
    });

    socket.on("access_page", () => {
        let room = "";
        if(socket.rooms.size == 2) {
            room = Array.from(socket.rooms)[1];
            io.to(room).emit("room_response", room);
            io.to(getBoss(room)).emit("boss_notified", `Boss`);
            io.in(room).emit("clients_count", io.sockets.adapter.rooms.get(room).size);
        }
    });

    socket.on("send_message", (data) => {
        io.in(Array.from(socket.rooms)[1]).emit("receive_message", data);
    });

    socket.on("disconnect", () => {
        let rooms = getRooms(io);
        rooms.forEach(room => {
            io.in(room).emit("clients_count", io.sockets.adapter.rooms.get(room).size);
            io.to(getBoss(room)).emit("boss_notified", `Boss`);
        });
    });
})

server.listen(port, () => {
    console.log("SERVER IS RUNNING NOW");
});

function getRooms(io) {
    const rooms = new Array();
    const allRooms = io.sockets.adapter.rooms;
    for (let [roomNumber, roomClients] of allRooms) {
        if(reg.test(roomNumber)) {
            rooms.push(roomNumber)
        }
    }
    return rooms;
}

function getBoss(room) {
    return Array.from(io.sockets.adapter.rooms.get(room))[0];
}