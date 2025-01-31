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
    let hasUserInteractedWithAudio = false;
    const userId = 'user_' + Math.random().toString(36).substr(2, 9);
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    
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
            audio.volume = 1.0;
            
            // iOS Safari specific setup
            if (isIOS) {
                audio.playsinline = true;
                audio.muted = false;
            }
            
            // Add play button for mobile if needed
            let playButton = null;
            if (isIOS && !hasUserInteractedWithAudio) {
                playButton = document.createElement('button');
                playButton.className = 'play-button';
                playButton.textContent = '▶️ Listen to Kaia (Enable Audio)';
                playButton.style.cssText = `
                    background: #ff3366;
                    color: white;
                    border: none;
                    padding: 0.5rem 1rem;
                    border-radius: 5px;
                    margin: 0.5rem 0;
                    cursor: pointer;
                    font-weight: 600;
                    width: 100%;
                `;
            }

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
            
            // Add play button for iOS only if user hasn't interacted yet
            if (playButton) {
                messageDiv.appendChild(playButton);
            }
            
            messages.appendChild(messageDiv);
            messages.scrollTop = messages.scrollHeight;
            
            return new Promise((resolve, reject) => {
                let hasStartedPlaying = false;

                const startPlayback = async () => {
                    if (!hasStartedPlaying) {
                        hasStartedPlaying = true;
                        console.log('Starting playback');
                        try {
                            const playPromise = audio.play();
                            if (playPromise !== undefined) {
                                playPromise
                                    .then(() => {
                                        console.log('Playback started successfully');
                                        if (playButton) {
                                            playButton.style.display = 'none';
                                            hasUserInteractedWithAudio = true;
                                            // Store the interaction state in localStorage
                                            if (isIOS) {
                                                localStorage.setItem('hasUserInteractedWithAudio', 'true');
                                            }
                                        }
                                    })
                                    .catch(error => {
                                        console.error('Error starting playback:', error);
                                        if (playButton) {
                                            playButton.style.display = 'block';
                                        }
                                        reject(error);
                                    });
                            }
                        } catch (error) {
                            console.error('Error during play():', error);
                            reject(error);
                        }
                    }
                };

                // Check if we've already interacted with audio
                if (isIOS) {
                    hasUserInteractedWithAudio = localStorage.getItem('hasUserInteractedWithAudio') === 'true';
                }

                audio.addEventListener('canplaythrough', () => {
                    console.log('Audio can play through');
                    if (!isIOS || hasUserInteractedWithAudio) {
                        startPlayback();
                    }
                }, { once: true });

                if (playButton) {
                    playButton.addEventListener('click', () => {
                        startPlayback();
                    });
                }
                
                audio.addEventListener('playing', () => {
                    console.log('Audio is playing');
                });

                audio.addEventListener('ended', () => {
                    console.log('Audio ended naturally');
                    currentAudio = null;
                    socket.emit('audio-complete');
                    if (playButton) {
                        playButton.style.display = 'none';
                    }
                    resolve();
                });
                
                audio.addEventListener('error', (e) => {
                    console.error('Audio error:', e);
                    console.error('Audio error code:', audio.error.code);
                    socket.emit('audio-complete');
                    reject(new Error(`Audio error: ${audio.error.message}`));
                });

                // Set the source and start loading
                audio.src = audioUrl;
                currentAudio = audio;
                audio.load();

                // Set timeout for audio loading
                setTimeout(() => {
                    if (!hasStartedPlaying) {
                        socket.emit('audio-complete');
                        reject(new Error('Audio loading timeout'));
                    }
                }, 10000);
            });
        } catch (error) {
            console.error('Error in playAudioResponse:', error);
            socket.emit('audio-complete');
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

    socket.on('new-message', (data) => {
        console.log('Received new message:', data);
        // Only add messages from other users
        if (data.userId !== userId) {
            console.log('Message is from another user, adding to chat');
            addMessage(data.message, 'user', data.userName || 'Anonymous');
        } else {
            console.log('Message is from current user, skipping');
        }
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
    sendMessage.addEventListener('click', async () => {
        if (!validateName()) {
            nameInput.focus();
            return;
        }
        
        const message = messageInput.value.trim();
        const name = nameInput.value.trim();
        
        if (message && name) {
            console.log('Sending message:', message);
            const messageData = {
                message: message,
                userId: userId,
                userName: name,
                timestamp: new Date().toISOString()
            };
            
            // Send message to all users
            console.log('Broadcasting message to all users');
            socket.emit('send-message', messageData);
            
            // Add message to local chat
            console.log('Adding message to local chat');
            addMessage(message, 'user', name);
            
            // Request Kaia's response
            console.log('Requesting Kaia response');
            socket.emit('get-response', messageData);
            
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