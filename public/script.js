// Initialize socket connection
const socket = io();

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
    
    // Remove default random name and setup validation
    nameInput.addEventListener('input', () => {
        if (nameInput.value.trim()) {
            nameInput.classList.remove('error');
            nameInput.style.borderColor = 'rgba(255, 51, 102, 0.3)';
        }
    });
    
    // Function to validate name
    function validateName() {
        if (!nameInput.value.trim()) {
            nameInput.classList.add('error');
            nameInput.focus();
            return false;
        }
        nameInput.classList.remove('error');
        return true;
    }

    // Function to generate random listener count
    function updateListenerCount() {
        const randomCount = Math.floor(Math.random() * (14000 - 11000 + 1)) + 11000;
        listenerCount.textContent = randomCount.toLocaleString();
    }

    // Update listener count initially and every 30 seconds
    updateListenerCount();
    setInterval(updateListenerCount, 30000);
    
    function formatTimestamp(date) {
        return new Date(date).toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: true
        });
    }
    
    function addMessage(content, type, name) {
        if (type === 'user') {
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
    }
    
    function stopCurrentAudio() {
        if (currentAudio) {
            try {
                currentAudio.pause();
                currentAudio.src = '';
                currentAudio = null;
            } catch (error) {
                console.error('Error stopping audio:', error);
            }
        }
    }
    
    async function playAudioResponse(audioUrl, text, originalMessage, userName) {
        try {
            console.log('Starting audio playback for:', audioUrl);
            stopCurrentAudio();
            
            // Create and configure audio element
            const audio = new Audio();
            audio.crossOrigin = "anonymous";
            audio.preload = "auto";
            audio.volume = 1.0;  // Maximum volume

            // Add Kaia's text response as a message
            const messageDiv = document.createElement('div');
            messageDiv.className = 'message kaia';
            
            const headerDiv = document.createElement('div');
            headerDiv.className = 'header';
            
            const nameSpan = document.createElement('span');
            nameSpan.className = 'name';
            nameSpan.textContent = 'Kaia';
            
            const timestampSpan = document.createElement('span');
            timestampSpan.className = 'timestamp';
            timestampSpan.textContent = formatTimestamp(new Date());
            
            headerDiv.appendChild(nameSpan);
            headerDiv.appendChild(timestampSpan);
            
            const contentDiv = document.createElement('div');
            contentDiv.className = 'content';
            contentDiv.textContent = text;
            
            messageDiv.appendChild(headerDiv);
            messageDiv.appendChild(contentDiv);
            
            messages.appendChild(messageDiv);
            messages.scrollTop = messages.scrollHeight;
            
            return new Promise((resolve, reject) => {
                let hasStartedPlaying = false;

                audio.addEventListener('loadeddata', () => {
                    console.log('Audio data loaded');
                }, { once: true });

                audio.addEventListener('canplaythrough', () => {
                    if (!hasStartedPlaying) {
                        hasStartedPlaying = true;
                        console.log('Audio can play through, starting playback');
                        try {
                            const playPromise = audio.play();
                            if (playPromise !== undefined) {
                                playPromise
                                    .then(() => {
                                        console.log('Playback started successfully');
                                    })
                                    .catch(error => {
                                        console.error('Error starting playback:', error);
                                        reject(error);
                                    });
                            }
                        } catch (error) {
                            console.error('Error during play():', error);
                            reject(error);
                        }
                    }
                });
                
                audio.addEventListener('playing', () => {
                    console.log('Audio is playing');
                });

                audio.addEventListener('ended', () => {
                    console.log('Audio ended naturally');
                    currentAudio = null;
                    socket.emit('audio-complete'); // Notify server that audio finished playing
                    resolve();
                });
                
                audio.addEventListener('error', (e) => {
                    console.error('Audio error:', e);
                    console.error('Audio error code:', audio.error.code);
                    socket.emit('audio-complete'); // Notify server even if there's an error
                    reject(new Error(`Audio error: ${audio.error.message}`));
                });

                // Set the source after adding event listeners
                audio.src = audioUrl;
                currentAudio = audio;

                // Set timeout for audio loading
                setTimeout(() => {
                    if (!hasStartedPlaying) {
                        socket.emit('audio-complete'); // Notify server if audio fails to start
                        reject(new Error('Audio loading timeout'));
                    }
                }, 10000);
            });
        } catch (error) {
            console.error('Error in playAudioResponse:', error);
            socket.emit('audio-complete'); // Notify server if there's any error
            throw error;
        }
    }
    
    // Socket event handlers
    socket.on('connect', () => {
        console.log('Connected to server');
        addMessage('Connected to server', 'system', 'System');
    });
    
    socket.on('connect_error', (error) => {
        console.error('Connection error:', error);
        addMessage('Connection error. Please try again.', 'system', 'System');
    });

    // Remove or comment out the listener-count handler since we're using random numbers
    // socket.on('listener-count', (count) => {
    //     listenerCount.textContent = count;
    // });
    
    socket.on('new-message', (data) => {
        // Only add messages from other users or if it's our first time seeing it
        addMessage(data.message, 'user', data.userName || 'Anonymous');
    });
    
    socket.on('kaia-response', async (data) => {
        try {
            console.log('Received Kaia response:', data);
            if (data.audioUrl && data.text) {
                console.log('Starting audio playback for URL:', data.audioUrl);
                try {
                    await playAudioResponse(
                        data.audioUrl, 
                        data.text, 
                        data.originalMessage,
                        data.userName
                    );
                } catch (error) {
                    console.error('Audio playback error:', error);
                }
            } else {
                console.error('Missing audio URL or text in response');
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
            console.log('Sending message:', message);
            socket.emit('send-message', {
                message: message,
                userId: userId,
                userName: name
            });
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
}); 