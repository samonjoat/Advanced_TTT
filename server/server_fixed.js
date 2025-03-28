const express = require('express');
const http = require('http');
const WebSocket = require('ws');

const app = express();

// Create HTTP server
const server = http.createServer(app);

// Create WebSocket server
const wss = new WebSocket.Server({ server });

const gameSessions = {};

function generateSessionId() {
    return Math.random().toString(36).substring(2, 15);
}

let nextPlayerId = 1; // Counter for player IDs

wss.on('connection', ws => {
    console.log('Client connected');
    ws.id = `player-${nextPlayerId++}`; // Assign unique player ID
    ws.gameSessionId = null; // Track session ID for this connection
    console.log(`Client connected with ID: ${ws.id}`); // Log client ID

    ws.on('message', message => {
        console.log('Received message:', message);
        try {
            const parsedMessage = JSON.parse(message);

            if (parsedMessage.action === 'createSession') {
                const sessionId = generateSessionId();
                gameSessions[sessionId] = {
                    board: ["", "", "", "", "", "", "", "", ""],
                    players: [ws], // Creator is the first player
                    playerSymbols: {}, // Initialize playerSymbols here
                    scores: { X: 0, O: 0, draws: 0 } // Initialize scoreboard
                };
                gameSessions[sessionId].playerSymbols[ws.id] = 'X'; // Assign 'X' to creator
                ws.gameSessionId = sessionId;
                ws.send(JSON.stringify({ action: 'sessionCreated', sessionId }));
                console.log(`Session created: ${sessionId}`);
            } else if (parsedMessage.action === 'joinSession') {
                const sessionId = parsedMessage.sessionId;
                if (gameSessions[sessionId]) {
                    gameSessions[sessionId].players.push(ws);
                    ws.gameSessionId = sessionId;
                    ws.send(JSON.stringify({ action: 'sessionJoined', sessionId }));
                    // Log players array to debug
                    console.log('Players in session:', gameSessions[sessionId].players);
                    // Notify session creator (player X) that player O has joined
                    gameSessions[sessionId].players[0].send(JSON.stringify({ action: 'opponentJoined', sessionId }));

                    // Assign player symbols and store them in session
                    const playerX = gameSessions[sessionId].players[0];
                    const playerO = ws; // Joiner is Player O
                    gameSessions[sessionId].playerSymbols[playerO.id] = 'O'; // Assign 'O' to joiner

                    // Notify both players to start the game
                    const session = gameSessions[sessionId];
                    session.gameStatus = 'active';
                    session.currentPlayer = 'X'; // X starts first
                    session.players.forEach(playerWs => {
                        const playerType = gameSessions[sessionId].playerSymbols[playerWs.id];
                        playerWs.send(JSON.stringify({
                            action: 'gameStart',
                            playerType: playerType,
                            currentPlayer: session.currentPlayer // Initial current player is X
                        }));
                    });

                    broadcastGameState(sessionId); // Broadcast initial game state to both players
                    console.log(`Client joined session: ${sessionId}`);
                } else {
                    ws.send(JSON.stringify({ action: 'sessionNotFound', sessionId }));
                }
            } else if (parsedMessage.action === 'makeMove') {
                handleMove(ws, parsedMessage);
            }
        } catch (error) {
            console.error('Failed to parse message:', error);
            ws.send(JSON.stringify({ action: 'error', message: 'Invalid message format' }));
        }
    });
});

wss.on('close', ws => {
    console.log('Client disconnected');
    if (ws.gameSessionId) {
        const sessionId = ws.gameSessionId;
        gameSessions[sessionId].players = gameSessions[sessionId].players.filter(player => player !== ws);
        if (gameSessions[sessionId].players.length === 0) {
            delete gameSessions[sessionId]; // Clean up empty sessions
            console.log(`Session ${sessionId} closed and removed.`);
        } else {
            console.log(`Client left session: ${sessionId}. Remaining players: ${gameSessions[sessionId].players.length}`);
        }
    }
});

function broadcastGameState(sessionId) {
    const session = gameSessions[sessionId];
    if (!session) return;
    const gameState = {
        action: 'gameStateUpdate',
        board: session.board,
        currentPlayer: session.currentPlayer,
        gameStatus: session.gameStatus, // 'active', 'won', 'draw'
        winningPlayer: session.winningPlayer, // 'X' or 'O' if won
        scores: session.scores // Include scores in game state updates
    };
    session.players.forEach(playerWs => {
        playerWs.send(JSON.stringify(gameState));
    });
}

const winningConditions = [
    [0, 1, 2],
    [3, 4, 5],
    [6, 7, 8],
    [0, 3, 6],
    [1, 4, 7],
    [2, 5, 8],
    [0, 4, 8],
    [2, 4, 6]
];

function checkWin(board) {
    for (let condition of winningConditions) {
        const [a, b, c] = condition;
        if (board[a] && board[a] === board[b] && board[a] === board[c]) {
            return board[a]; // Winner ('X' or 'O')
        }
    }
    return null; // No winner
}

function checkDraw(board) {
    return !board.includes(""); // Board is full and no winner
}


function handleMove(ws, message) {
    const sessionId = ws.gameSessionId;
    if (!sessionId || !gameSessions[sessionId]) {
        return ws.send(JSON.stringify({ action: 'error', message: 'Session not found' }));
    }

    const session = gameSessions[sessionId];
    if (session.players.indexOf(ws) === -1) {
        return ws.send(JSON.stringify({ action: 'error', message: 'Player not in session' }));
    }

    const playerSymbol = session.playerSymbols[ws.id];
    if (!playerSymbol) {
        return ws.send(JSON.stringify({ action: 'error', message: 'Player symbol not assigned' }));
    }
    
    if (playerSymbol !== session.currentPlayer) {
        return ws.send(JSON.stringify({ 
            action: 'invalidMove', 
            message: `Not your turn. Current turn: Player ${session.currentPlayer}` 
        }));
    }

    const cellIndex = message.cellIndex;
    if (typeof cellIndex !== 'number' || cellIndex < 0 || cellIndex > 8) {
        return ws.send(JSON.stringify({ action: 'invalidMove', message: 'Invalid cell index' }));
    }

    if (session.board[cellIndex] !== "") {
        return ws.send(JSON.stringify({ action: 'invalidMove', message: 'Cell already taken' }));
    }

    if (session.gameStatus === 'won' || session.gameStatus === 'draw') {
        return ws.send(JSON.stringify({ action: 'invalidMove', message: 'Game already over' }));
    }

    session.board[cellIndex] = playerSymbol;
    const winner = checkWin(session.board);
    const draw = checkDraw(session.board);

    if (winner) {
        session.gameStatus = 'won';
        session.winningPlayer = winner;
        session.scores[winner]++;
        broadcastGameState(sessionId);
    } else if (draw) {
        session.gameStatus = 'draw';
        session.scores.draws++;
        broadcastGameState(sessionId);
    } else {
        session.currentPlayer = session.currentPlayer === 'X' ? 'O' : 'X';
        broadcastGameState(sessionId);
    }
}

server.listen(3000, () => { // Hardcoded port 3000, removed PORT variable
    console.log(`Server started on port 3000`);
    console.log(`WebSocket server is listening on port 3000`); // Added log
});
