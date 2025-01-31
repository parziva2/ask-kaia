// Initialize socket connection with the correct server URL
const serverUrl = window.location.hostname === 'localhost' 
    ? 'http://localhost:3000' 
    : 'https://synthetic-woman.onrender.com';

console.log('Connecting to server at:', serverUrl);

const socket = io(serverUrl, {
    transports: ['polling', 'websocket'],
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    timeout: 20000,
    autoConnect: true,
    withCredentials: true,
    forceNew: true,
    path: '/socket.io/',
    extraHeaders: {
        'Access-Control-Allow-Origin': window.location.origin
    }
});

// Add detailed connection status handling
socket.on('connect', () => {
    console.log('Connected to server successfully');
    console.log('Transport:', socket.io.engine.transport.name);
    console.log('Connection URL:', serverUrl);
});

socket.on('connect_error', (error) => {
    console.error('Connection error:', error);
    console.log('Failed to connect to:', serverUrl);
    console.log('Current transport:', socket.io.engine.transport.name);
    
    // Try to reconnect with polling if WebSocket fails
    if (socket.io.engine.transport.name === 'websocket') {
        console.log('Falling back to polling transport');
        socket.io.opts.transports = ['polling'];
        socket.connect();
    }
});

socket.on('disconnect', (reason) => {
    console.log('Disconnected:', reason);
    if (reason === 'io server disconnect') {
        // the disconnection was initiated by the server, you need to reconnect manually
        socket.connect();
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
    sendMessage.addEventListener('click', async () => {
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

    // Helper functions
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

            audio.addEventListener('error', (e) => {
                console.error('Audio error:', e);
                currentAudio = null;
                socket.emit('audio-complete');
            });

            await audio.play().catch((error) => {
                console.error('Playback failed:', error);
                socket.emit('audio-complete');
            });

        } catch (error) {
            console.error('Error in playAudioResponse:', error);
            socket.emit('audio-complete');
        }
    }

    // Helper function to detect iOS
    function isIOS() {
        return [
            'iPad Simulator',
            'iPhone Simulator',
            'iPod Simulator',
            'iPad',
            'iPhone',
            'iPod'
        ].includes(navigator.platform)
        || (navigator.userAgent.includes("Mac") && "ontouchend" in document);
    }

    // Update listener count initially and every 30 seconds
    updateListenerCount();
    setInterval(updateListenerCount, 30000);
}); 