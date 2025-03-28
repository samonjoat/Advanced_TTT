const message = document.getElementById('message');
const gameboard = document.getElementById('gameboard');
const cells = document.querySelectorAll('.cell');
const resetBtn = document.getElementById('resetBtn');
const createSessionBtn = document.getElementById('createSessionBtn'); // New button
const joinSessionBtn = document.getElementById('joinSessionBtn'); // New button
const sessionIdInput = document.getElementById('sessionIdInput'); // New input
const quitBtn = document.getElementById('quitBtn');

const websocket = new WebSocket('ws://localhost:3000');
let sessionId = null;
let playerSymbol = null; // 'X' or 'O'

websocket.onopen = () => {
    console.log('WebSocket connection opened');
    message.innerHTML = 'Connected to server.<br>Create or join a session.'
};

websocket.onmessage = (event) => {
    const messageData = JSON.parse(event.data);
    console.log('Received message:', messageData);

    switch (messageData.action) {
        case 'sessionCreated':
            sessionId = messageData.sessionId;
            playerSymbol = 'X'; // First player is always 'X'
            message.innerText = `Session created. Session ID: ${sessionId}. You are Player X. Waiting for Player O...`;
            createSessionBtn.disabled = true; // Disable create session after session is created
            joinSessionBtn.disabled = true; // Disable join session after session is created
            break;
        case 'sessionJoined':
            sessionId = messageData.sessionId;
            playerSymbol = 'O'; // Second player is 'O'
            message.innerText = `Joined session ${sessionId}. You are Player O. Your turn.`;
            createSessionBtn.disabled = true; // Disable create session after joining session
            joinSessionBtn.disabled = true; // Disable join session after joining session
            break;
        case 'sessionNotFound':
            message.innerText = `Session ${messageData.sessionId} not found. Please create a new session or check the session ID.`;
            break;
        case 'opponentJoined':
            message.innerText = `Player O has joined the session!`;
            break;
        case 'gameStart':
            playerSymbol = messageData.playerType;
            message.innerText = `Game started! You are Player ${playerSymbol}. ${messageData.currentPlayer}'s turn first.`;
            break;
        case 'gameStateUpdate':
            updateGameboard(messageData);
            // Handle game resolution
            if (messageData.gameStatus === 'won') {
                message.innerText = `Player ${messageData.winningPlayer} wins!`;
                resetBtn.disabled = false;
            } else if (messageData.gameStatus === 'draw') {
                message.innerText = "Game ended in a draw!";
                resetBtn.disabled = false;
            }
            break;
        case 'invalidMove':
            message.innerText = messageData.message;
            break;
        case 'gameWon':
            message.innerText = `Player ${messageData.winningPlayer} wins! Game over.`;
            break;
        case 'gameDraw':
            message.innerText = "It's a draw! Game over.";
            break;
        case 'error':
            message.innerText = `Server error: ${messageData.message}`;
            break;
        default:
            console.log('Unknown message action:', messageData.action);
    }
};

websocket.onerror = (error) => {
    console.error('WebSocket error:', error);
    message.innerText = 'Failed to connect to server. Please check server connection.';
};

websocket.onclose = () => {
    console.log('WebSocket connection closed');
    message.innerText = 'Disconnected from server.';
};


function handleCellClick(clickedCellEvent) {
    if (!sessionId) {
        message.innerText = 'Please create or join a session first.';
        return;
    }
    if (!playerSymbol) {
        message.innerText = 'Waiting to join a session...';
        return;
    }
    
    const clickedCell = clickedCellEvent.target;
    if (clickedCell.innerText !== '') {
        message.innerText = 'This cell is already taken!';
        return;
    }

    const clickedCellIndex = parseInt(clickedCell.dataset.index);

    // Send 'makeMove' message to server
    websocket.send(JSON.stringify({
        action: 'makeMove',
        sessionId: sessionId,
        cellIndex: clickedCellIndex,
        playerSymbol: playerSymbol // Optional, server can track players
    }));
}


const playerXScoreSpan = document.getElementById('playerXScore');
const playerOScoreSpan = document.getElementById('playerOScore');
const drawsScoreSpan = document.getElementById('drawsScore');

function updateGameboard(gameState) {
    gameState.board.forEach((cellValue, index) => {
        cells[index].innerText = cellValue;
    });
    
    if (gameState.gameStatus === 'active') {
        const isYourTurn = gameState.currentPlayer === playerSymbol;
        const turnText = isYourTurn ? 
            'Your turn' : 
            `Opponent's turn (${gameState.currentPlayer})`;
        message.innerText = turnText;
        
        document.querySelectorAll('.cell').forEach(cell => {
            cell.style.opacity = isYourTurn ? '1' : '0.6';
            cell.style.cursor = isYourTurn ? 'pointer' : 'not-allowed';
        });
    } else if (gameState.gameStatus === 'won') {
        const winner = gameState.winningPlayer;
        message.innerText = winner === playerSymbol ? 'You won! 🎉' : 'Opponent won!';
        disableBoard();
    } else if (gameState.gameStatus === 'draw') {
        message.innerText = "It's a draw! 🤝";
        disableBoard();
    }

    if (gameState.scores) {
        playerXScoreSpan.innerText = gameState.scores.X || 0;
        playerOScoreSpan.innerText = gameState.scores.O || 0;
        drawsScoreSpan.innerText = gameState.scores.draws || 0;
    }
}

function disableBoard() {
    document.querySelectorAll('.cell').forEach(cell => {
        cell.style.opacity = '0.6';
        cell.style.cursor = 'not-allowed';
    });
}

function resetGame() {
    if (websocket.readyState === WebSocket.OPEN && sessionId) {
        websocket.send(JSON.stringify({
            action: 'resetGame',
            sessionId: sessionId
        }));
        document.querySelectorAll('.cell').forEach(cell => {
            cell.innerText = '';
            cell.style.opacity = '1';
            cell.style.cursor = 'pointer';
        });
        resetBtn.disabled = true; // Disable reset button until next game ends
        message.innerText = 'Game reset! Starting new game...';
    } else {
        message.innerText = 'Cannot reset game. Not connected to a session.';
    }
}

function quitGame() {
    if (websocket.readyState === WebSocket.OPEN) {
        websocket.send(JSON.stringify({
            action: 'quitSession',
            sessionId: sessionId
        }));
    }
    sessionId = null;
    playerSymbol = null;
    document.querySelectorAll('.cell').forEach(cell => {
        cell.innerText = '';
        cell.style.opacity = '1';
        cell.style.cursor = 'pointer';
    });
    message.innerText = 'Game session ended. Create or join a new session to play again.';
    createSessionBtn.disabled = false;
    joinSessionBtn.disabled = false;
}

// Add event listener for page refresh confirmation
window.addEventListener('beforeunload', (event) => {
    if (sessionId) {
        event.preventDefault();
        event.returnValue = 'You have an active game session. Are you sure you want to leave? Your game history will be lost.';
        return event.returnValue;
    }
});
function createSession() {
    if (websocket.readyState === WebSocket.OPEN) {
        websocket.send(JSON.stringify({ action: 'createSession' }));
    } else {
        message.innerText = 'Not connected to server. Please refresh the page.';
    }
}

function joinSession() {
    const sessionIdToJoin = sessionIdInput.value;
    if (websocket.readyState === WebSocket.OPEN && sessionIdToJoin) {
        websocket.send(JSON.stringify({ action: 'joinSession', sessionId: sessionIdToJoin }));
    } else {
        message.innerText = 'Invalid session ID or not connected to server.';
    }
}


cells.forEach(cell => {
    cell.addEventListener('click', handleCellClick);
});
resetBtn.addEventListener('click', resetGame);
quitBtn.addEventListener('click', quitGame);
createSessionBtn.addEventListener('click', createSession);
joinSessionBtn.addEventListener('click', joinSession);
