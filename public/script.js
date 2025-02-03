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

// Add connection status logging with more detail
socket.on('connect', () => {
    console.log('Connected to server successfully');
    const systemMessage = document.createElement('div');
    systemMessage.className = 'system-message success';
    systemMessage.textContent = 'Connected to server';
    document.getElementById('messages').appendChild(systemMessage);
    processMessageQueue();
});

socket.on('connect_error', (error) => {
    console.error('Connection error:', error);
    const systemMessage = document.createElement('div');
    systemMessage.className = 'system-message error';
    systemMessage.textContent = 'Connection error: ' + error.message + ' - retrying...';
    document.getElementById('messages').appendChild(systemMessage);
    
    if (socket.io.engine?.transport?.name === 'websocket') {
        console.log('Falling back to polling transport');
        socket.io.opts.transports = ['polling'];
    }
});

socket.on('disconnect', (reason) => {
    console.log('Disconnected from server:', reason);
    const systemMessage = document.createElement('div');
    systemMessage.className = 'system-message';
    systemMessage.textContent = 'Disconnected from server - attempting to reconnect...';
    document.getElementById('messages').appendChild(systemMessage);
    
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
    const messagesDiv = document.getElementById('messages');
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
    
    // Add data attributes for cross-device sync
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
    const systemMessage = document.createElement('div');
    systemMessage.className = 'system-message error';
    systemMessage.textContent = 'Error: ' + error.message;
    document.getElementById('messages').appendChild(systemMessage);
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
        // Process next message if any
        processMessageQueue();
    });
}

// Handle form submission
document.getElementById('message-form').onsubmit = function(e) {
    e.preventDefault();
    const messageInput = document.getElementById('message-input');
    const nameInput = document.getElementById('name-input');
    const message = messageInput.value.trim();
    const name = (nameInput ? nameInput.value.trim() : 'User') || 'User';
    
    if (message) {
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
            socket.emit('send-message', messageData);
        } else {
            messageQueue.push(messageData);
            console.log('Message queued, waiting for connection');
        }

        messageInput.value = '';
        messageInput.focus();
    }
};

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

document.addEventListener('DOMContentLoaded', () => {
    // DOM Elements
    const messages = document.getElementById('messages');
    const nameInput = document.getElementById('nameInput');
    const messageInput = document.getElementById('messageInput');
    const sendMessage = document.getElementById('sendMessage');
    const listenerCount = document.getElementById('listenerCount');
    
    // State management
    let currentAudio = null;
    
    // Socket event handlers
    socket.on('new-message', (data) => {
        if (data.userId !== deviceId) {
            addMessage(data.message, 'user', data.userName || 'Anonymous');
        }
    });
    
    socket.on('kaia-response', async (data) => {
        try {
            if (data.audioUrl && data.text) {
                addMessage(data.text, 'kaia', 'Kaia');
                await playAudioResponse(data.audioUrl);
            }
        } catch (error) {
            console.error('Error handling Kaia response:', error);
        }
    });
    
    // Message handling
    sendMessage.addEventListener('click', () => {
        if (!validateName()) {
            nameInput.focus();
            return;
        }
        
        const message = messageInput.value.trim();
        const name = nameInput.value.trim();
        
        if (message && name) {
            const messageData = {
                message: message,
                userId: deviceId,
                userName: name,
                timestamp: new Date().toISOString()
            };
            
            // Add message to local chat
            addMessage(message, 'user', name);
            
            // Send message to server
            socket.emit('send-message', messageData);
            
            messageInput.value = '';
        }
    });
    
    messageInput.addEventListener('keypress', (event) => {
        if (event.key === 'Enter') {
            if (!validateName()) {
                nameInput.focus();
                return;
            }
            sendMessage.click();
        }
    });

    function validateName() {
        if (!nameInput.value.trim()) {
            nameInput.classList.add('error');
            nameInput.focus();
            return false;
        }
        nameInput.classList.remove('error');
        return true;
    }

    function updateListenerCount() {
        const randomCount = Math.floor(Math.random() * (14000 - 11000 + 1)) + 11000;
        listenerCount.textContent = randomCount.toLocaleString();
    }

    function formatTimestamp(date) {
        return new Date(date).toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: true
        });
    }
    
    function addMessage(content, type, name) {
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${type}`;
        
        const headerDiv = document.createElement('div');
        headerDiv.className = 'header';
        
        const nameSpan = document.createElement('span');
        nameSpan.className = 'name';
        nameSpan.textContent = name;
        
        const timestampSpan = document.createElement('span');
        timestampSpan.className = 'timestamp';
        timestampSpan.textContent = formatTimestamp(new Date());
        
        headerDiv.appendChild(nameSpan);
        headerDiv.appendChild(timestampSpan);
        
        const contentDiv = document.createElement('div');
        contentDiv.className = 'content';
        contentDiv.textContent = content;
        
        messageDiv.appendChild(headerDiv);
        messageDiv.appendChild(contentDiv);
        
        messages.appendChild(messageDiv);
        messages.scrollTop = messages.scrollHeight;
    }
    
    function stopCurrentAudio() {
        if (currentAudio) {
            currentAudio.pause();
            currentAudio = null;
        }
    }
    
    async function playAudioResponse(audioUrl) {
        try {
            stopCurrentAudio();
            
            const audio = new Audio(audioUrl);
            currentAudio = audio;
            
            audio.addEventListener('ended', () => {
                currentAudio = null;
                socket.emit('audio-complete');
            });

            await audio.play().catch(() => {
                socket.emit('audio-complete');
            });

        } catch (error) {
            console.error('Error in playAudioResponse:', error);
            socket.emit('audio-complete');
        }
    }

    // Update listener count initially and every 30 seconds
    updateListenerCount();
    setInterval(updateListenerCount, 30000);
}); 