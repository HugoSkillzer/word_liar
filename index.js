const express = require("express");
const app = express();
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const { connect } = require("http2");
const fetch = require("node-fetch");

app.use(cors());

const mapGamesLaunched = new Map();
const mapUsersPseudos = new Map();
const mapUsersResumeWords = new Map();
const mapGamesWordsToSend = new Map();

let wordsToPlay = [];

const reg = /^[0-9]*$/;
const port = process.env.PORT || 3001;

const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: '*'
    }
});

io.on("connection", (socket) => {
    sendDefaultPseudo(io, socket);

    socket.on("join_room", (data) => {
        mapUsersPseudos.set(socket.id, data.pseudo);
        if(mapGamesLaunched.get(data.room)) {
            io.to(socket.id).emit('room_occupied', 'There is already a game played in this room');
        } else {
            if(socket.rooms.size == 2) {
                let room = Array.from(socket.rooms)[1]
                socket.leave(room);
                io.to(getBoss(room)).emit("boss_notified", `Boss`);
            }
            socket.join(data.room);
            io.to(socket.id).emit("room_response", data.room);
            io.to(getBoss(data.room)).emit("boss_notified", `Boss`);
            if(getBoss(data.room) != socket.id) {
                io.to(socket.id).emit("boss_notified", `Not Boss`);
            }
            let rooms = getRooms(io);
            rooms.forEach(room => {
                io.in(room).emit("clients_count", io.sockets.adapter.rooms.get(room).size);
            });
        }
    });

    socket.on("access_page", () => {
        let room = "";
        if(socket.rooms.size == 2) {
            room = Array.from(socket.rooms)[1];
            io.to(room).emit("room_response", room);
            io.to(getBoss(room)).emit("boss_notified", `Boss`);
            io.in(room).emit("clients_count", io.sockets.adapter.rooms.get(room).size);
        }
        sendDefaultPseudo(io, socket);
    });

    socket.on("send_message", (data) => {
        io.in(Array.from(socket.rooms)[1]).emit("receive_message", data);
    });

    socket.on("launch_game", () => {
        let room = Array.from(socket.rooms)[1];
        let players = io.sockets.adapter.rooms.get(room);
        let playersNumber = players.size
        const mapUsersInGame = new Map();
        Array.from(players).forEach(player => {
            mapUsersInGame.set(player, mapUsersPseudos.get(player));
        });
        mapGamesLaunched.set(room, true);
        io.in(room).emit("game_launched");
        const wordsToSend = [];
        wordsNumber = 3*playersNumber;
        fetch("https://trouve-mot.fr/api/random/"+wordsNumber)
            .then((response) => response.json())
            .then((words) => {
                words.forEach(word => {
                    wordsToSend.push(word.name);
                });
                mapGamesWordsToSend.set(room, wordsToSend);
                Array.from(players).forEach(player => {
                    io.to(player).emit("your_words", `${wordsToSend[0]}, ${wordsToSend[1]}, ${wordsToSend[2]}`);
                    wordsToSend.splice(0,3);
                })
            })
    });

    socket.on("resume_word", (data) => {
        let room = Array.from(socket.rooms)[1];
        let players = Array.from(io.sockets.adapter.rooms.get(room));
        let playersNumber = players.length;
        let playersThatPlayed = [];
        mapUsersResumeWords.set(socket.id, data);
        for (let key of mapUsersResumeWords.keys()) {
            if(players.includes(key)) {
                playersThatPlayed.push(key);
            }
        }
        if(playersThatPlayed.length == playersNumber) {
            io.in(room).emit("play_game");
        } else {
            io.in(room).emit("players_ready", `Still waiting for ${playersNumber - playersThatPlayed.length} players...`);
        }
    });

    socket.on("disconnect", () => {
        mapUsersPseudos.delete(socket.id);
        mapUsersResumeWords.delete(socket.id);
        let rooms = getRooms(io);
        if(rooms.length == 0) {
            mapGamesLaunched.clear();
        }
        rooms.forEach(room => {
            io.in(room).emit("clients_count", io.sockets.adapter.rooms.get(room).size);
            io.to(getBoss(room)).emit("boss_notified", `Boss`);
            for (let key of mapGamesLaunched.keys()) {
                if(!rooms.includes(key)) {
                    mapGamesLaunched.delete(key);
                }
            }
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
    if(io.sockets.adapter.rooms.get(room)) {
        return Array.from(io.sockets.adapter.rooms.get(room))[0];
    }
}

function sendDefaultPseudo(io, socket) {
    let pseudo = "";
        fetch("https://random-word-api.vercel.app/api?words=2&type=capitalized")
            .then((response) => response.json())
            .then((words) => {
                words.forEach(word => {
                    pseudo+= word;
                });
                pseudo += Math.floor(Math.random() * (99 - 11 + 1) + 11);
                io.to(socket.id).emit('default_pseudo', pseudo);
            })
}