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

// Add connection status logging with more detail
socket.on('connect', () => {
    console.log('Connected to server successfully');
    document.getElementById('messages').innerHTML += '<div class="system-message success">Connected to server</div>';
});

socket.on('connect_error', (error) => {
    console.error('Connection error:', error);
    document.getElementById('messages').innerHTML += '<div class="system-message error">Connection error: ' + error.message + ' - retrying...</div>';
    
    // Try to reconnect with polling if WebSocket fails
    if (socket.io.engine && socket.io.engine.transport && socket.io.engine.transport.name === 'websocket') {
        console.log('Falling back to polling transport');
        socket.io.opts.transports = ['polling'];
    }
});

socket.on('disconnect', (reason) => {
    console.log('Disconnected from server:', reason);
    document.getElementById('messages').innerHTML += '<div class="system-message">Disconnected from server - attempting to reconnect...</div>';
    
    // Force a reconnection attempt
    if (!socket.connected) {
        setTimeout(() => {
            console.log('Attempting to reconnect...');
            socket.connect();
        }, 2000);
    }
});

document.addEventListener('DOMContentLoaded', () => {
    // DOM Elements
    const messages = document.getElementById('messages');
    const nameInput = document.getElementById('nameInput');
    const messageInput = document.getElementById('messageInput');
    const sendMessage = document.getElementById('sendMessage');
    const listenerCount = document.getElementById('listenerCount');
    
    // State management
    let currentAudio = null;
    const userId = 'user_' + Math.random().toString(36).substr(2, 9);
    
    // Socket event handlers
    socket.on('new-message', (data) => {
        if (data.userId !== userId) {
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
                userId: userId,
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