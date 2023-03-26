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
const mapPseudosUsers = new Map();
const mapUsersWordsReceived = new Map();
const mapUsersResumeWords = new Map();
const mapGamesWordsToPlay = new Map();
const mapGamesResume = new Map();

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
        mapPseudosUsers.set(data.pseudo, socket.id);
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
        let playersNumber = io.sockets.adapter.rooms.get(data.room).size;
        if(playersNumber == 3) {
            io.to(getBoss(data.room)).emit('can_play');
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
        mapGamesLaunched.set(room, true);
        mapGamesResume.set(room, new Map());
        io.in(room).emit("game_launched");
        const wordsToSend = [];
        const wordsToPlay = [];
        wordsNumber = 3*playersNumber;
        fetch("https://trouve-mot.fr/api/random/"+wordsNumber)
            .then((response) => response.json())
            .then((words) => {
                words.forEach(word => {
                    wordsToSend.push(word.name);
                    wordsToPlay.push(word.name);
                });
                mapGamesWordsToPlay.set(room, wordsToPlay);
                Array.from(players).forEach(player => {
                    io.to(player).emit("your_words", `${wordsToSend[0]}, ${wordsToSend[1]}, ${wordsToSend[2]}`);
                    mapUsersWordsReceived.set(wordsToSend[0], player);
                    mapUsersWordsReceived.set(wordsToSend[1], player);
                    mapUsersWordsReceived.set(wordsToSend[2], player);
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

    socket.on("game_rounds_init", () => {
        const mapResumeWordsToSend = new Map();
        let room = Array.from(socket.rooms)[1];
        if(room) {
            let players = Array.from(io.sockets.adapter.rooms.get(room));
            let otherPlayers = [];
            players.forEach(player => {
                if(player != socket.id) {
                    otherPlayers.push(player);
                }
            });
            otherPlayers.forEach(player => {
                mapResumeWordsToSend.set(mapUsersPseudos.get(player), mapUsersResumeWords.get(player));
            });
            const json = JSON.stringify(Object.fromEntries(mapResumeWordsToSend));
            io.to(socket.id).emit('resume_words', json);
        }
    });

    socket.on('play_next_round', () => {
        let room = Array.from(socket.rooms)[1];
        let wordsToPlay = mapGamesWordsToPlay.get(room);
        let players = Array.from(io.sockets.adapter.rooms.get(room));
        let roundNumber = players.length * 3 - wordsToPlay.length + 1;
        if(roundNumber < players.length * 3 + 1) {
            wordsToPlay.sort(() => (Math.random() > .5) ? 1 : -1);
            if(roundNumber == players.length * 3) {
                io.in(room).emit('round_number', "end");
            }
            io.in(room).emit('round_number', roundNumber);
            let mapRoundInfo = new Map();
            let mapRounds = mapGamesResume.get(room);
            let mapPoints = new Map();
            let mapGlobalPoints = new Map();
            let mapTraitorVotes = new Map();
            let mapInnocentVotes = new Map();
            if(!mapRounds) {
                mapRounds = new Map();
            }
            players.forEach(player => {
                mapPoints.set(mapUsersPseudos.get(player), 0);
                mapGlobalPoints.set(mapUsersPseudos.get(player), 0);
            });
            mapRoundInfo.set("traitorVotes", mapTraitorVotes);
            mapRoundInfo.set("innocentVotes", mapInnocentVotes);
            mapRoundInfo.set("points", mapPoints);
            mapRoundInfo.set("word", wordsToPlay[0]);
            mapRounds.set(roundNumber, mapRoundInfo);
            if(roundNumber == 1) {
                mapRounds.set("globalPoints", mapGlobalPoints);
            }
            mapGamesResume.set(room, mapRounds);
            players.forEach(playerToContact => {
                io.to(playerToContact).emit("word_to_guess", wordsToPlay[0]);
                io.to(playerToContact).emit('traitor', false);
                if(playerToContact != mapUsersWordsReceived.get(wordsToPlay[0])) {
                    let otherPlayers = [];
                    players.forEach(player => {
                        if(player != playerToContact) {
                            otherPlayers.push(mapUsersPseudos.get(player));
                        }
                    if(players.length == 3) {
                        io.to(playerToContact).emit('no_innocent_vote');
                    }
                    io.to(playerToContact).emit('other_players', otherPlayers);
                    });
                } else {
                    io.to(playerToContact).emit('other_players', []);
                    io.to(playerToContact).emit('traitor', true);
                }
            });
            wordsToPlay.splice(0,1);
        }
    });

    //data => roundNumber, traitor, innocent, word + socketId
    socket.on("vote", (data) => {
        let room = Array.from(socket.rooms)[1];
        if(room) {
            let playersNumber = io.sockets.adapter.rooms.get(room).size;
            let mapRounds = mapGamesResume.get(room);
            let mapRoundInfo = mapRounds.get(data.roundNumber);
            let mapTraitorVotes = mapRoundInfo.get("traitorVotes");
            let mapInnocentVotes = new Map();
            mapTraitorVotes.set(mapUsersPseudos.get(socket.id), data.traitor);
            if(playersNumber > 3) {
                mapInnocentVotes = mapRoundInfo.get("innocentVotes");
                mapInnocentVotes.set(mapUsersPseudos.get(socket.id), data.innocent);
            }
            let mapPoints = mapRoundInfo.get("points");
            if(mapUsersWordsReceived.get(data.wordToGuess) != mapPseudosUsers.get(data.traitor)) {
                let points = mapPoints.get(data.traitor);
                points++;
                mapPoints.set(data.traitor, points);
                points = mapPoints.get(mapUsersPseudos.get(mapUsersWordsReceived.get(data.wordToGuess)));
                points++;
                mapPoints.set(mapUsersPseudos.get(mapUsersWordsReceived.get(data.wordToGuess)), points);
            } else {
                let points = mapPoints.get(mapUsersPseudos.get(socket.id));
                points++;
                mapPoints.set(mapUsersPseudos.get(socket.id), points);
            }
            if(mapTraitorVotes.size === playersNumber-1) {
                if(playersNumber > 3) {
                    let numberOfVotesAgainstTraitor = 0;
                    for (let vote of mapInnocentVotes.values()){
                        if(mapUsersWordsReceived.get(data.wordToGuess) === mapPseudosUsers.get(vote)) {
                            numberOfVotesAgainstTraitor++;
                        }
                    }
                    if(numberOfVotesAgainstTraitor >= Math.ceil((playersNumber-1) / 2)) {
                        points = mapPoints.get(mapUsersPseudos.get(mapUsersWordsReceived.get(data.wordToGuess)));
                        points = 0;
                        mapPoints.set(mapUsersPseudos.get(mapUsersWordsReceived.get(data.wordToGuess)), points);
                    }
                }
                let mapGlobalPoints = mapRounds.get('globalPoints');
                for (let player of mapGlobalPoints.keys()) {
                    let points = mapGlobalPoints.get(player);
                    let pointsToAdd = mapPoints.get(player);
                    let pointsResult = points+pointsToAdd;
                    mapGlobalPoints.set(player, pointsResult);
                }
            io.to(getBoss(room)).emit("vote_complete");
            }
        }
    });

    //data => roundNumber, traitor, innocent, word + socketId
    socket.on("show_results", (data) => {
        let room = Array.from(socket.rooms)[1];
        io.to(room).emit("go_to_results");
    });

    //data => roundNumber, traitor, innocent, word + socketId
    socket.on("ask_results", (data) => {
        let room = Array.from(socket.rooms)[1];
        if(room) {
            let mapRounds = mapGamesResume.get(room);
            let mapGlobalPoints = mapRounds.get('globalPoints');
            const mapSortPoints = new Map([...mapGlobalPoints.entries()].sort((a, b) => b[1] - a[1]));
            const json = JSON.stringify(Object.fromEntries(mapSortPoints));
            io.to(socket.id).emit("ranking", json);
            if(mapSortPoints.keys().next().value === mapUsersPseudos.get(socket.id)) {
                io.to(socket.id).emit("victory")
            } else {
                io.to(socket.id).emit("defeat")
            }
        }
    });

    socket.on("disconnect_from_game", () => {
        let room = Array.from(socket.rooms)[1];
        if(room) {
            mapPseudosUsers.delete(mapUsersPseudos.get(socket.id));
            mapUsersPseudos.delete(socket.id);
            mapUsersResumeWords.delete(socket.id);
            socket.leave(room);
            let rooms = getRooms(io);
            if(rooms.length == 0) {
                mapGamesLaunched.clear();
            }
            if(io.sockets.adapter.rooms.get(room)?.size > 2) {
                io.in(room).emit("clients_count", io.sockets.adapter.rooms.get(room).size);
                io.to(getBoss(room)).emit("boss_notified", `Boss`);
                let wordsToPlay = mapGamesWordsToPlay.get(room);
                let wordsToKeep = [];
                wordsToPlay.forEach(word => {
                    if(mapUsersWordsReceived.get(word) === socket.id) {
                        mapUsersWordsReceived.delete(word);
                    } else {
                        wordsToKeep.push(word);
                    }
                });
                mapGamesWordsToPlay.set(room, wordsToKeep);
            } else {
                mapGamesLaunched.delete(room);
                mapGamesResume.delete(room);
                let wordsToPlay = mapGamesWordsToPlay.get(room);
                wordsToPlay.forEach(word => {
                    mapUsersWordsReceived.delete(word);
                    });
                if(!io.sockets.adapter.rooms.get(room)) {
                    mapGamesWordsToPlay.delete(room);
                }
                io.in(room).emit("no_enough_player");
            }
        }
    });

    socket.on("disconnect", () => {
        mapPseudosUsers.delete(mapUsersPseudos.get(socket.id));
        mapUsersPseudos.delete(socket.id);
        mapUsersResumeWords.delete(socket.id);
        let rooms = getRooms(io);
        if(rooms.length == 0) {
            mapGamesLaunched.clear();
        }
        rooms.forEach(room => {
            if(io.sockets.adapter.rooms.get(room).size > 2) {
                io.in(room).emit("clients_count", io.sockets.adapter.rooms.get(room).size);
                io.to(getBoss(room)).emit("boss_notified", `Boss`);
                let wordsToPlay = mapGamesWordsToPlay.get(room);
                let wordsToKeep = [];
                wordsToPlay?.forEach(word => {
                    if(mapUsersWordsReceived.get(word) === socket.id) {
                        mapUsersWordsReceived.delete(word);
                    } else {
                        wordsToKeep.push(word);
                    }
                });
                mapGamesWordsToPlay.set(room, wordsToKeep);
            } else {
                mapGamesLaunched.delete(room);
                mapGamesResume.delete(room);
                let wordsToPlay = mapGamesWordsToPlay.get(room);
                wordsToPlay?.forEach(word => {
                    mapUsersWordsReceived.delete(word);
                    });
                if(!io.sockets.adapter.rooms.get(room)) {
                    mapGamesWordsToPlay.delete(room);
                }
                io.in(room).emit("no_enough_player");
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