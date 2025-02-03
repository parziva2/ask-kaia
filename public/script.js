// Initialize socket connection with the correct server URL
const socket = io('https://ask-kaia.onrender.com', {
    transports: ['polling', 'websocket'],
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    timeout: 20000,
    autoConnect: true,
    withCredentials: true,
    path: '/socket.io'
});

let messageQueue = [];
let isProcessing = false;
let deviceId = localStorage.getItem('deviceId') || 'device_' + Math.random().toString(36).substr(2, 9);
localStorage.setItem('deviceId', deviceId);

// Create messages container if it doesn't exist
function ensureMessagesContainer() {
    let messagesDiv = document.getElementById('messages');
    if (!messagesDiv) {
        messagesDiv = document.createElement('div');
        messagesDiv.id = 'messages';
        messagesDiv.className = 'messages';
        document.querySelector('.chat-container')?.appendChild(messagesDiv);
    }
    return messagesDiv;
}

// Add a system message
function addSystemMessage(message, type = '') {
    const messagesDiv = ensureMessagesContainer();
    const systemMessage = document.createElement('div');
    systemMessage.className = `system-message ${type}`;
    systemMessage.textContent = message;
    messagesDiv.appendChild(systemMessage);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

// Socket event handlers
socket.on('connect', () => {
    console.log('Connected to server successfully');
    addSystemMessage('Connected to server', 'success');
    processMessageQueue();
});

socket.on('connect_error', (error) => {
    console.error('Connection error:', error);
    addSystemMessage('Connection error: ' + error.message + ' - retrying...', 'error');
    
    if (socket.io.engine?.transport?.name === 'websocket') {
        console.log('Falling back to polling transport');
        socket.io.opts.transports = ['polling'];
    }
});

socket.on('disconnect', (reason) => {
    console.log('Disconnected from server:', reason);
    addSystemMessage('Disconnected from server - attempting to reconnect...');
    
    if (!socket.connected) {
        setTimeout(() => {
            console.log('Attempting to reconnect...');
            socket.connect();
        }, 2000);
    }
});

// Handle incoming messages
socket.on('new-message', (data) => {
    console.log('Received message:', data);
    const messagesDiv = ensureMessagesContainer();

    const messageDiv = document.createElement('div');
    messageDiv.className = data.isAI ? 'message ai-message' : 'message user-message';
    
    const timestamp = document.createElement('span');
    timestamp.className = 'timestamp';
    timestamp.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    
    const userName = document.createElement('strong');
    userName.textContent = data.userName || 'Unknown User';
    
    const messageContent = document.createElement('span');
    messageContent.className = 'message-content';
    messageContent.textContent = data.message;
    
    messageDiv.appendChild(timestamp);
    messageDiv.appendChild(userName);
    messageDiv.appendChild(document.createTextNode(': '));
    messageDiv.appendChild(messageContent);
    
    messageDiv.dataset.messageId = data.messageId || Date.now().toString();
    messageDiv.dataset.deviceId = data.deviceId || deviceId;
    
    messagesDiv.appendChild(messageDiv);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
});

// Handle audio playback
socket.on('play-audio', (data) => {
    console.log('Received audio data:', data);
    const audio = new Audio(data.audioPath);
    audio.onended = () => {
        console.log('Audio playback completed');
        socket.emit('audio-complete');
    };
    audio.onerror = (error) => {
        console.error('Audio playback error:', error);
        socket.emit('audio-complete');
    };
    audio.play().catch(error => {
        console.error('Failed to play audio:', error);
        socket.emit('audio-complete');
    });
});

// Handle errors
socket.on('error', (error) => {
    console.error('Server error:', error);
    addSystemMessage('Error: ' + error.message, 'error');
});

function processMessageQueue() {
    if (!socket.connected || isProcessing || messageQueue.length === 0) {
        return;
    }

    isProcessing = true;
    const message = messageQueue.shift();
    
    socket.emit('send-message', message, (error) => {
        isProcessing = false;
        if (error) {
            console.error('Error sending message:', error);
            messageQueue.unshift(message);
        }
        processMessageQueue();
    });
}

// Initialize form handling when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    const messageForm = document.getElementById('message-form');
    const messageInput = document.getElementById('message-input');
    const nameInput = document.getElementById('name-input');

    if (!messageForm || !messageInput) {
        console.error('Required form elements not found!');
        return;
    }

    // Handle form submission
    messageForm.addEventListener('submit', function(e) {
        e.preventDefault();
        console.log('Form submitted');
        
        const message = messageInput.value.trim();
        const name = (nameInput ? nameInput.value.trim() : 'User') || 'User';
        
        if (message) {
            console.log('Sending message:', message);
            const messageId = Date.now().toString();
            const messageData = {
                message: message,
                userId: 'user-' + messageId,
                userName: name,
                messageId: messageId,
                deviceId: deviceId,
                timestamp: new Date().toISOString()
            };

            if (socket.connected) {
                console.log('Socket connected, sending message directly');
                socket.emit('send-message', messageData);
            } else {
                console.log('Socket not connected, queueing message');
                messageQueue.push(messageData);
            }

            messageInput.value = '';
            messageInput.focus();
        }
    });

    // Handle Enter key press
    messageInput.addEventListener('keypress', (event) => {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            messageForm.dispatchEvent(new Event('submit'));
        }
    });

    // Update listener count periodically
    function updateListenerCount() {
        const listenerCount = document.getElementById('listenerCount');
        if (listenerCount) {
            const randomCount = Math.floor(Math.random() * (14000 - 11000 + 1)) + 11000;
            listenerCount.textContent = randomCount.toLocaleString();
        }
    }

    // Update listener count every 30 seconds
    updateListenerCount();
    setInterval(updateListenerCount, 30000);
});

// Add styles
const style = document.createElement('style');
style.textContent = `
.message {
    padding: 10px;
    margin: 5px 0;
    border-radius: 8px;
    max-width: 80%;
    word-wrap: break-word;
}

.user-message {
    background-color: #e3f2fd;
    margin-left: auto;
    margin-right: 10px;
    color: #1565c0;
}

.ai-message {
    background-color: #fce4ec;
    margin-left: 10px;
    margin-right: auto;
    color: #c2185b;
}

.timestamp {
    font-size: 0.8em;
    color: #666;
    margin-right: 8px;
}

.system-message {
    text-align: center;
    color: #666;
    font-style: italic;
    margin: 5px 0;
    font-size: 0.9em;
}

.system-message.error {
    color: #d32f2f;
}

.system-message.success {
    color: #388e3c;
}

.message-content {
    display: inline-block;
    margin-left: 5px;
}
`;
document.head.appendChild(style); 