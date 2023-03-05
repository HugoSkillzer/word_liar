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
        origin: "http://localhost:3000",
        methods: ["GET", "POST"],
    }
});

io.on("connection", (socket) => {
    console.log(`User Connected : ${socket.id}`);

    socket.on("join_room", (data) => {
        if(socket.rooms.size == 2) {
            socket.leave(Array.from(socket.rooms)[1]);
        }
        socket.join(data);
        let rooms = getRooms(io);
        rooms.forEach(room => {
            io.in(room).emit("clients_count", io.sockets.adapter.rooms.get(room).size);
        });
    });

    socket.on("send_message", (data) => {
        io.in(data.room).emit("receive_message", data);
    });

    socket.on("disconnect", () => {
        let rooms = getRooms(io);
        rooms.forEach(room => {
            io.in(room).emit("clients_count", io.sockets.adapter.rooms.get(room).size);
        })
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