// Initialize Socket.IO with proper error handling
const socket = io('http://localhost:3000', {
    reconnection: true,
    reconnectionAttempts: 5,
    reconnectionDelay: 1000
});

// DOM Elements
const liveMessages = document.getElementById('live-messages');
const liveQuestion = document.getElementById('live-question');
const queueStatus = document.getElementById('queue-status');
const listenerCount = document.getElementById('listener-count');
const slotsAvailable = document.getElementById('slots-available');
const mainPlayButton = document.getElementById('main-play-button');
const nowPlaying = document.getElementById('now-playing');

// Track current audio state
let currentAudio = null;
let currentAudioElement = null;
let isRadioPlaying = false;
let messageCount = 0;
const MAX_MESSAGES = 10;

// Initialize audio recording variables
let mediaRecorder = null;
let audioChunks = [];
let recordingTimer = null;
let recordingStartTime = null;
let audioContext = null;
let analyser = null;
let visualizerCanvas = null;
let canvasCtx = null;

// Generate a random user ID if not exists
if (!localStorage.getItem('userId')) {
    localStorage.setItem('userId', 'user_' + Math.random().toString(36).substr(2, 9));
}

// Format timestamp
function formatTimestamp(timestamp) {
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// Show welcome message
function showWelcomeMessage() {
    const messageDiv = document.createElement('div');
    messageDiv.className = 'live-message welcome';
    messageDiv.innerHTML = `
        <div class="answer">
            Welcome to Sarah's Live Radio Show! Click the "Start Listening" button above to join the fun. 
            Once you start listening, you can interact with me and other listeners through the chat below.
            I love hearing from my listeners and responding to your questions live on air!
        </div>
        <div class="meta">
            <span class="time">${formatTimestamp(new Date())}</span>
            <span class="welcome-tag">Welcome</span>
        </div>
    `;
    liveMessages.insertBefore(messageDiv, liveMessages.firstChild);
}

// Call this when page loads
showWelcomeMessage();

// Handle main play button with improved streaming
if (mainPlayButton) {
    mainPlayButton.addEventListener('click', () => {
        if (!isRadioPlaying) {
            // Start playing radio
            isRadioPlaying = true;
            mainPlayButton.textContent = '⏸️ Pause Radio';
            socket.emit('start-radio');
            if (nowPlaying) {
                nowPlaying.textContent = 'Connecting to radio stream...';
            }
            
            // Clear welcome message
            const welcomeMsg = document.querySelector('.welcome');
            if (welcomeMsg) {
                welcomeMsg.remove();
            }

            // Add connection status message
            const statusDiv = document.createElement('div');
            statusDiv.className = 'status-message';
            statusDiv.textContent = 'Connecting to radio stream...';
            liveMessages.insertBefore(statusDiv, liveMessages.firstChild);

            // Remove status message after connection is established
            setTimeout(() => {
                if (statusDiv.parentNode) {
                    statusDiv.remove();
                }
            }, 3000);
        } else {
            // Pause radio
            isRadioPlaying = false;
            mainPlayButton.textContent = '▶️ Start Listening';
            socket.emit('stop-radio');
            if (currentAudioElement) {
                currentAudioElement.pause();
                if (currentAudio && currentAudio.playButton) {
                    currentAudio.playButton.textContent = '▶️ Play';
                }
                if (currentAudio && currentAudio.messageDiv) {
                    currentAudio.messageDiv.classList.remove('current-playing');
                }
            }
            if (nowPlaying) {
                nowPlaying.textContent = 'Radio paused';
            }
        }
    });
}

// Handle audio playback with improved error handling and auto-retry
function playAudioResponse(audioUrl, messageDiv, text, type, musicData = null) {
    if (!isRadioPlaying) return; // Don't play if radio is paused

    // Create audio element if not exists
    if (!currentAudioElement) {
        currentAudioElement = new Audio();
        
        // Set up audio element event handlers for continuous playback
        currentAudioElement.onended = () => {
            console.log('Audio ended, checking for music or requesting next content');
            if (musicData && musicData.musicUrl) {
                // If this was an intro, play the actual music
                playMusic(musicData);
            } else if (isRadioPlaying) {
                socket.emit('request-next-content');
            }
        };
    }

    // Ensure audioUrl is properly formatted
    const fullAudioUrl = audioUrl.startsWith('http') ? audioUrl : `http://localhost:3000${audioUrl}`;
    console.log('Playing audio from URL:', fullAudioUrl);

    // Set up audio element
    currentAudioElement.src = fullAudioUrl;
    
    // Auto-play with retry logic
    const playWithRetry = (retryCount = 0) => {
        currentAudioElement.play()
            .then(() => {
                console.log('Audio playing successfully');
                if (nowPlaying) {
                    if (type === 'music') {
                        nowPlaying.textContent = `Now playing: ${text} (Introducing: ${musicData.musicTitle})`;
                    } else {
                        nowPlaying.textContent = `Now playing: ${text}`;
                    }
                }
            })
            .catch(error => {
                console.error('Error playing audio:', error);
                if (retryCount < 3) {
                    console.log(`Retrying playback (attempt ${retryCount + 1}/3)...`);
                    setTimeout(() => playWithRetry(retryCount + 1), 1000);
                } else {
                    if (nowPlaying) nowPlaying.textContent = 'Error playing audio. Requesting new content...';
                    socket.emit('request-next-content');
                }
            });
    };

    // Start playback
    playWithRetry();
}

// Add music message styling
const style = document.createElement('style');
style.textContent = `
    .live-message {
        transition: all 0.3s ease;
        border-left: 4px solid transparent;
    }
    
    .relevance-1 { border-left-color: #ffd700; }
    .relevance-2 { border-left-color: #ffa500; }
    .relevance-3 { border-left-color: #ff6b6b; }
    .relevance-4 { border-left-color: #ff4500; }
    .relevance-5 { border-left-color: #ff1493; }
    
    .relevance-indicator {
        font-size: 0.8em;
        color: #ffd700;
        margin-top: 4px;
    }
    
    .radio-segment {
        display: flex;
        gap: 12px;
        background: rgba(0,0,0,0.05);
        padding: 12px;
        border-radius: 8px;
    }
    
    .host-avatar {
        font-size: 1.5em;
    }
    
    .host-name {
        font-weight: bold;
        color: #ff1493;
        margin-bottom: 4px;
    }
    
    .topic-tag {
        display: inline-block;
        background: rgba(255,20,147,0.1);
        color: #ff1493;
        padding: 2px 8px;
        border-radius: 12px;
        font-size: 0.8em;
        margin-top: 8px;
    }

    .user-content {
        background: rgba(255, 255, 255, 0.1);
        padding: 12px;
        border-radius: 8px;
        margin-bottom: 8px;
    }

    .user-content .message {
        color: #fff;
        font-size: 16px;
        line-height: 1.4;
    }

    .quoted-question {
        font-style: italic;
        color: rgba(255, 255, 255, 0.7);
        margin-top: 8px;
        padding-left: 12px;
        border-left: 2px solid rgba(255, 255, 255, 0.3);
    }

    .radio-segment {
        background: rgba(255, 20, 147, 0.1);
        padding: 15px;
        border-radius: 12px;
        margin-bottom: 8px;
    }

    .radio-segment .answer {
        color: #fff;
        font-size: 16px;
        line-height: 1.5;
        margin: 8px 0;
    }

    .user-tag {
        background: rgba(255, 255, 255, 0.2);
        padding: 2px 8px;
        border-radius: 12px;
        font-size: 12px;
        color: rgba(255, 255, 255, 0.9);
    }

    .music-segment {
        background: linear-gradient(135deg, rgba(255, 20, 147, 0.2), rgba(147, 20, 255, 0.2));
        padding: 15px;
        border-radius: 12px;
        margin-bottom: 8px;
        border-left: 4px solid #ff1493;
    }

    .music-info {
        display: flex;
        align-items: center;
        gap: 10px;
        margin-top: 8px;
    }

    .music-icon {
        font-size: 1.5em;
    }

    .music-details {
        flex: 1;
    }

    .music-title {
        font-weight: bold;
        color: #ff1493;
    }

    .music-artist {
        color: rgba(255, 255, 255, 0.8);
        font-size: 0.9em;
    }

    .music-genre {
        display: inline-block;
        background: rgba(255, 20, 147, 0.3);
        color: #ff1493;
        padding: 2px 8px;
        border-radius: 12px;
        font-size: 0.8em;
        margin-top: 4px;
    }

    .music-progress {
        height: 3px;
        background: rgba(255, 255, 255, 0.1);
        border-radius: 3px;
        margin-top: 8px;
        overflow: hidden;
    }

    .progress-bar {
        height: 100%;
        background: linear-gradient(90deg, #ff1493, #9314ff);
        width: 0%;
        transition: width 0.5s linear;
    }
`;
document.head.appendChild(style);

// Enhanced music playback function with better audio handling
function playMusic(musicData) {
    if (!isRadioPlaying) return;

    console.log('Starting music playback:', musicData);

    // Create a new Audio element for music
    const musicElement = new Audio();
    
    // Set up event listeners before setting source
    musicElement.oncanplaythrough = () => {
        console.log('Music loaded and can play through');
        try {
            // Stop any currently playing audio
            if (currentAudioElement) {
                currentAudioElement.pause();
                currentAudioElement.src = '';
            }
            
            currentAudioElement = musicElement;
            
            // Start playback
            const playPromise = musicElement.play();
            if (playPromise !== undefined) {
                playPromise.then(() => {
                    console.log('Music started playing successfully');
                    if (nowPlaying) {
                        nowPlaying.textContent = `Now playing: ${musicData.musicTitle} by ${musicData.musicArtist} (${musicData.musicGenre})`;
                    }
                }).catch(error => {
                    console.error('Error during music playback:', error);
                    socket.emit('request-next-content');
                });
            }
        } catch (error) {
            console.error('Error in music playback:', error);
            socket.emit('request-next-content');
        }
    };

    musicElement.onended = () => {
        console.log('Music ended, requesting next content');
        if (isRadioPlaying) {
            socket.emit('request-next-content');
        }
    };

    musicElement.onerror = (e) => {
        console.error('Music error:', e);
        socket.emit('request-next-content');
    };

    // Set up progress bar
    const progressBar = document.querySelector('.progress-bar');
    if (progressBar) {
        musicElement.addEventListener('timeupdate', () => {
            if (musicElement.duration) {
                const progress = (musicElement.currentTime / musicElement.duration) * 100;
                progressBar.style.width = `${progress}%`;
            }
        });
    }

    // Set source and load
    try {
        const fullMusicUrl = musicData.musicUrl.startsWith('http') ? musicData.musicUrl : `http://localhost:3000${musicData.musicUrl}`;
        console.log('Loading music from URL:', fullMusicUrl);
        musicElement.src = fullMusicUrl;
        musicElement.load();
    } catch (error) {
        console.error('Error setting music source:', error);
        socket.emit('request-next-content');
    }
}

// Enhanced message display for music
function addLiveMessage(data) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `live-message ${data.type || 'user-message'}`;
    
    let content = '';
    if (data.type === 'music') {
        content = `
            <div class="music-segment">
                <div class="host-avatar">🎙️</div>
                <div class="content">
                    <div class="host-name">Sarah</div>
                    <div class="answer">${data.text}</div>
                    <div class="music-info">
                        <div class="music-icon">🎵</div>
                        <div class="music-details">
                            <div class="music-title">${data.musicTitle}</div>
                            <div class="music-artist">${data.musicArtist}</div>
                            <div class="music-genre">${data.musicGenre}</div>
                        </div>
                    </div>
                    <div class="music-progress">
                        <div class="progress-bar"></div>
                    </div>
                </div>
            </div>
        `;
    } else if (data.type === 'entertainment' || data.type === 'listener_response') {
        content = `
            <div class="radio-segment">
                <div class="host-avatar">🎙️</div>
                <div class="content">
                    <div class="host-name">Sarah</div>
                    <div class="answer">${data.text}</div>
                    ${data.topic ? `<div class="topic-tag">${data.topic}</div>` : ''}
                    ${data.question ? `<div class="quoted-question">Responding to: "${data.question}"</div>` : ''}
                </div>
            </div>
        `;
    } else {
        content = `
            <div class="user-content">
                <div class="message">${data.text}</div>
                ${data.score ? `<div class="relevance-indicator" title="Message Relevance">
                    ${'⭐'.repeat(Math.floor(data.score/3))}
                </div>` : ''}
            </div>
        `;
    }
    
    messageDiv.innerHTML = `
        ${content}
        <div class="meta">
            <span class="time">${formatTimestamp(data.timestamp)}</span>
            ${data.userId ? `<span class="user-tag">Listener #${data.userId.slice(-4)}</span>` : ''}
        </div>
    `;
    
    if (liveMessages) {
        if (liveMessages.children.length >= MAX_MESSAGES) {
            liveMessages.removeChild(liveMessages.lastChild);
        }
    liveMessages.insertBefore(messageDiv, liveMessages.firstChild);
    }

    return messageDiv;
}

// Send a live question
async function sendLiveQuestion() {
    if (!liveQuestion) return;  // Guard against null element
    
    const message = liveQuestion.value.trim();
    
    if (message) {
        try {
            // Add user message to the feed immediately
            const userMessageDiv = addLiveMessage({
                text: message,
                type: 'user-message',
                timestamp: new Date(),
                userId: localStorage.getItem('userId')
            });

            socket.emit('live-question', {
                message,
                userId: localStorage.getItem('userId')
            });
            
            // Clear input
            liveQuestion.value = '';
            
            // Show temporary status
            if (queueStatus) {
                queueStatus.textContent = 'Question sent! Waiting for response...';
                setTimeout(() => {
                    queueStatus.textContent = '';
                }, 3000);
            }
            
        } catch (error) {
            console.error('Error sending question:', error);
            if (queueStatus) {
                queueStatus.textContent = 'Error sending question. Please try again.';
            }
        }
    }
}

// Socket.IO event handlers
socket.on('connect', () => {
    console.log('Connected to server');
    socket.emit('register-listener');
});

socket.on('listener-count', (count) => {
    if (listenerCount) listenerCount.textContent = count;
});

socket.on('slots-update', (data) => {
    if (slotsAvailable) slotsAvailable.textContent = data.available;
});

socket.on('live-response', (data) => {
    addLiveMessage(data);
});

socket.on('entertainment-content', (data) => {
    const messageDiv = addLiveMessage(data);
    if (data.audioUrl) {
        playAudioResponse(data.audioUrl, messageDiv, data.text, data.type);
    }
});

socket.on('current-audio', (data) => {
    if (data && data.url) {
        addLiveMessage({
            ...data,
            type: 'current',
            timestamp: new Date()
        });
    }
});

socket.on('initial-state', (data) => {
    // Update stats
    if (listenerCount) listenerCount.textContent = data.slots.total - data.slots.available;
    if (slotsAvailable) slotsAvailable.textContent = data.slots.available;
    
    // Add recent messages
    if (data.recentMessages) {
        data.recentMessages.forEach(message => addLiveMessage(message));
    }
    
    // Play current audio if available
    if (data.currentAudio) {
        addLiveMessage({
            ...data.currentAudio,
            type: 'current',
            timestamp: new Date()
        });
    }
});

// Add event listener for Enter key on live question input with null check
if (liveQuestion) {
    liveQuestion.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            sendLiveQuestion();
        }
    });
}

// Add event listener for send button if it exists
const sendButton = document.getElementById('send-question');
if (sendButton) {
    sendButton.addEventListener('click', sendLiveQuestion);
}

// Remove unnecessary chat functionality
async function sendMessage() {
    // This function is no longer needed
    console.log('Chat functionality is disabled');
}

// Remove problematic event listener
// document.getElementById('user-message').addEventListener('keypress', function(e) {
//     if (e.key === 'Enter') {
//         sendMessage();
//     }
// });

// Remove unnecessary conversation feed functionality
// const conversationMessages = document.getElementById('conversation-messages');

// function addConversationItem(message) {
//     // This function is no longer needed
// }

// Remove fetch call for interesting messages
// fetch('http://localhost:3000/api/interesting-messages')
//     .then(response => response.json())
//     .then(messages => {
//         messages.forEach(message => addConversationItem(message));
//     })
//     .catch(error => console.error('Error loading interesting messages:', error));

// Radio player functionality
document.addEventListener('DOMContentLoaded', function() {
    const audioPlayer = document.getElementById('radio-stream');
    const playButton = document.getElementById('play-radio');
    const currentContent = document.getElementById('current-content');
    
    let isPlaying = false;
    let retryCount = 0;
    const maxRetries = 3;

    async function startPlaying() {
        try {
            console.log('Starting radio stream...');
            const timestamp = new Date().getTime();
            
            // Create a new Audio element each time
            if (audioPlayer.src) {
                audioPlayer.src = '';
            }
            
            audioPlayer.src = `http://localhost:3000/radio-stream?t=${timestamp}`;
            audioPlayer.preload = 'auto';
            
            const playPromise = audioPlayer.play();
            if (playPromise !== undefined) {
                playPromise.then(() => {
                    console.log('Radio stream started successfully');
                    playButton.textContent = 'Pause Radio';
                    isPlaying = true;
                    retryCount = 0;
                }).catch(handlePlaybackError);
            }
        } catch (error) {
            handlePlaybackError(error);
        }
    }

    function handlePlaybackError(error) {
        console.error('Playback error:', error);
        if (retryCount < maxRetries) {
            retryCount++;
            console.log(`Retrying playback (attempt ${retryCount}/${maxRetries})...`);
            setTimeout(startPlaying, 1000);
        } else {
            currentContent.textContent = 'Error: Could not connect to radio server. Please try again later.';
            isPlaying = false;
            playButton.textContent = 'Play Radio';
        }
    }

    // Add event listener for stream ending
    audioPlayer.addEventListener('ended', () => {
        console.log('Stream ended, attempting to reconnect...');
        if (isPlaying) {
            startPlaying();
        }
    });

    // Add event listener for errors
    audioPlayer.addEventListener('error', (e) => {
        console.error('Audio error:', e);
        handlePlaybackError(e);
    });

    playButton.addEventListener('click', function() {
        if (!isPlaying) {
            startPlaying();
        } else {
            audioPlayer.pause();
            audioPlayer.src = '';
            playButton.textContent = 'Play Radio';
            isPlaying = false;
            currentContent.textContent = 'Radio paused';
        }
    });

    // Update current content display
    setInterval(async () => {
        if (isPlaying) {
            try {
                const response = await fetch('http://localhost:3000/current-content');
                if (response.ok) {
                    const data = await response.json();
                    currentContent.textContent = data.content;
                }
            } catch (error) {
                console.error('Error updating content:', error);
            }
        }
    }, 3000);
}); 

// Add socket connection error handling
socket.on('connect_error', (error) => {
    console.error('Socket connection error:', error);
    if (nowPlaying) {
        nowPlaying.textContent = 'Connection error. Please try again.';
    }
    // Reset play button state
    if (isRadioPlaying) {
        isRadioPlaying = false;
        if (mainPlayButton) {
            mainPlayButton.textContent = '▶️ Start Listening';
        }
    }
});

// Add socket reconnect handling
socket.on('reconnect', (attemptNumber) => {
    console.log('Reconnected to server after', attemptNumber, 'attempts');
    if (isRadioPlaying) {
        socket.emit('start-radio');
    }
});

// Add socket event for next content request
socket.on('next-content', (data) => {
    if (data && data.url) {
        const messageDiv = addLiveMessage({
            ...data,
            timestamp: new Date()
        });
        playAudioResponse(data.url, messageDiv, data.text, data.type);
    }
});

// Modify synchronized content handler for better audio transitions
socket.on('synchronized-content', (data) => {
    if (data.type === 'music') {
        console.log('Received music content:', data);
        
        // For music content, first play the intro, then the music
        const messageDiv = addLiveMessage({
            ...data,
            text: `🎵 ${data.text}\nNow playing: ${data.musicTitle} by ${data.musicArtist}`
        });

        // Create audio element for intro
        const introAudio = new Audio();
        
        // Set up event listeners before setting source
        introAudio.oncanplaythrough = () => {
            console.log('Intro loaded and can play through');
            try {
                // Stop any currently playing audio
                if (currentAudioElement) {
                    currentAudioElement.pause();
                    currentAudioElement.src = '';
                }
                
                currentAudioElement = introAudio;
                
                // Start playback
                const playPromise = introAudio.play();
                if (playPromise !== undefined) {
                    playPromise.then(() => {
                        console.log('Intro started playing successfully');
                    }).catch(error => {
                        console.error('Error during intro playback:', error);
                        // If intro fails, try to play music directly
                        playMusic({
                            musicUrl: data.musicUrl,
                            musicTitle: data.musicTitle,
                            musicArtist: data.musicArtist,
                            musicGenre: data.musicGenre
                        });
                    });
                }
            } catch (error) {
                console.error('Error in intro playback:', error);
                // If intro fails, try to play music directly
                playMusic({
                    musicUrl: data.musicUrl,
                    musicTitle: data.musicTitle,
                    musicArtist: data.musicArtist,
                    musicGenre: data.musicGenre
                });
            }
        };

        introAudio.onended = () => {
            console.log('Intro ended, starting music');
            playMusic({
                musicUrl: data.musicUrl,
                musicTitle: data.musicTitle,
                musicArtist: data.musicArtist,
                musicGenre: data.musicGenre
            });
        };

        introAudio.onerror = (e) => {
            console.error('Intro error:', e);
            // If intro fails, try to play music directly
            playMusic({
                musicUrl: data.musicUrl,
                musicTitle: data.musicTitle,
                musicArtist: data.musicArtist,
                musicGenre: data.musicGenre
            });
        };

        // Set source and load
        try {
            const fullIntroUrl = data.introAudioUrl.startsWith('http') ? data.introAudioUrl : `http://localhost:3000${data.introAudioUrl}`;
            console.log('Loading intro from URL:', fullIntroUrl);
            introAudio.src = fullIntroUrl;
            introAudio.load();
        } catch (error) {
            console.error('Error setting intro source:', error);
            // If intro fails, try to play music directly
            playMusic({
                musicUrl: data.musicUrl,
                musicTitle: data.musicTitle,
                musicArtist: data.musicArtist,
                musicGenre: data.musicGenre
            });
        }
    } else {
        // Handle regular content
        if (data && data.audioUrl) {
            const messageDiv = addLiveMessage(data);
            playAudioResponse(data.audioUrl, messageDiv, data.text, data.type);
        }
    }
});

document.addEventListener('DOMContentLoaded', () => {
    const socket = io();
    const messageForm = document.getElementById('message-form');
    const messageInput = document.getElementById('message-input');
    const nameInput = document.getElementById('name-input');
    const messagesDiv = document.getElementById('messages');
    const listenerCountSpan = document.getElementById('listenerCount');
    const messageCountSpan = document.getElementById('messageCount');

    // Initialize counters
    let messageCount = 0;
    let listenerCount = 0;

    // Update listener count
    socket.on('listener_count', (count) => {
        listenerCount = count;
        listenerCountSpan.textContent = count;
        animateNumber(listenerCountSpan, count);
    });

    // Update message count
    socket.on('message_count', (count) => {
        messageCount = count;
        messageCountSpan.textContent = count;
        animateNumber(messageCountSpan, count);
    });

    // Handle incoming messages
    socket.on('message', (data) => {
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${data.isAI ? 'ai' : 'user'}`;
        
        const contentDiv = document.createElement('div');
        contentDiv.className = 'message-content';
        
        const nameSpan = document.createElement('strong');
        nameSpan.textContent = data.name;
        
        const textSpan = document.createElement('span');
        textSpan.textContent = data.message;
        
        contentDiv.appendChild(nameSpan);
        contentDiv.appendChild(document.createElement('br'));
        contentDiv.appendChild(textSpan);
        
        if (data.isAI) {
            const contextDiv = document.createElement('div');
            contextDiv.className = 'response-context';
            contextDiv.textContent = 'Responding to a message from the audience';
            contentDiv.appendChild(contextDiv);
        }
        
        messageDiv.appendChild(contentDiv);
        messagesDiv.appendChild(messageDiv);
        
        // Scroll to bottom
        messagesDiv.scrollTop = messagesDiv.scrollHeight;
        
        // Increment message count
        messageCount++;
        messageCountSpan.textContent = messageCount;
    });

    // Handle form submission
    messageForm.addEventListener('submit', (e) => {
        e.preventDefault();
        
        const name = nameInput.value.trim();
        const message = messageInput.value.trim();
        
        if (name && message) {
            socket.emit('message', {
                name: name,
                message: message,
                timestamp: new Date().toISOString()
            });
            
            messageInput.value = '';
            
            // Save name in localStorage
            localStorage.setItem('userName', name);
        }
    });

    // Load saved username
    const savedName = localStorage.getItem('userName');
    if (savedName) {
        nameInput.value = savedName;
    }

    // Animate numbers
    function animateNumber(element, target) {
        const start = parseInt(element.textContent) || 0;
        const duration = 1000;
        const steps = 60;
        const increment = (target - start) / steps;
        let current = start;
        let step = 0;

        const animation = setInterval(() => {
            step++;
            current += increment;
            element.textContent = Math.round(current);

            if (step >= steps) {
                clearInterval(animation);
                element.textContent = target;
            }
        }, duration / steps);
    }

    // Character counter
    messageInput.addEventListener('input', () => {
        const maxLength = messageInput.getAttribute('maxlength');
        const currentLength = messageInput.value.length;
        
        if (currentLength >= maxLength) {
            messageInput.value = messageInput.value.slice(0, maxLength);
        }
    });

    // Auto-expand input field
    messageInput.addEventListener('input', function() {
        this.style.height = 'auto';
        this.style.height = (this.scrollHeight) + 'px';
    });

    // Initialize WebSocket connection
    socket.on('connect', () => {
        console.log('Connected to server');
    });

    socket.on('disconnect', () => {
        console.log('Disconnected from server');
    });

    socket.on('error', (error) => {
        console.error('Socket error:', error);
    });

    // Initialize audio recording functionality
    initializeAudioRecording();
});

// Initialize audio recording functionality
function initializeAudioRecording() {
    const recordButton = document.getElementById('record-button');
    const stopButton = document.getElementById('stop-recording');
    const audioControls = document.querySelector('.audio-controls');
    const timerDisplay = document.querySelector('.recording-timer');
    visualizerCanvas = document.getElementById('visualizer');
    canvasCtx = visualizerCanvas.getContext('2d');

    recordButton.addEventListener('click', async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            audioControls.style.display = 'flex';
            recordButton.style.display = 'none';
            
            // Set up audio context and analyser
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
            analyser = audioContext.createAnalyser();
            const source = audioContext.createMediaStreamSource(stream);
            source.connect(analyser);
            analyser.fftSize = 256;
            
            // Start recording
            mediaRecorder = new MediaRecorder(stream);
            audioChunks = [];
            recordingStartTime = Date.now();
            
            mediaRecorder.ondataavailable = (event) => {
                audioChunks.push(event.data);
            };
            
            mediaRecorder.onstop = async () => {
                const audioBlob = new Blob(audioChunks, { type: 'audio/wav' });
                const formData = new FormData();
                formData.append('audio', audioBlob);
                formData.append('userId', localStorage.getItem('userId') || 'anonymous');
                formData.append('userName', document.getElementById('name-input').value || 'Anonymous');
                
                try {
                    const response = await fetch('/upload-audio', {
                        method: 'POST',
                        body: formData
                    });
                    
                    if (!response.ok) throw new Error('Failed to upload audio');
                    
                    const result = await response.json();
                    console.log('Audio uploaded successfully:', result);
                    
                    // Reset UI
                    audioControls.style.display = 'none';
                    recordButton.style.display = 'block';
                    clearInterval(recordingTimer);
                    timerDisplay.textContent = '00:00';
                    
                    // Stop all tracks
                    stream.getTracks().forEach(track => track.stop());
                    
                    // Clean up audio context
                    if (audioContext) {
                        audioContext.close();
                        audioContext = null;
                    }
                } catch (error) {
                    console.error('Error uploading audio:', error);
                    // Show error message to user
                }
            };
            
            // Start recording and timer
            mediaRecorder.start();
            startRecordingTimer(timerDisplay);
            drawVisualizer();
            
        } catch (error) {
            console.error('Error accessing microphone:', error);
            alert('Unable to access microphone. Please check your permissions.');
        }
    });
    
    stopButton.addEventListener('click', () => {
        if (mediaRecorder && mediaRecorder.state === 'recording') {
            mediaRecorder.stop();
        }
    });
}

function startRecordingTimer(display) {
    recordingTimer = setInterval(() => {
        const elapsed = Date.now() - recordingStartTime;
        const seconds = Math.floor(elapsed / 1000);
        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = seconds % 60;
        display.textContent = `${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
        
        // Stop recording after 2 minutes
        if (seconds >= 120) {
            if (mediaRecorder && mediaRecorder.state === 'recording') {
                mediaRecorder.stop();
            }
        }
    }, 1000);
}

function drawVisualizer() {
    if (!analyser || !canvasCtx || !visualizerCanvas) return;
    
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    const width = visualizerCanvas.width;
    const height = visualizerCanvas.height;
    
    function draw() {
        if (!analyser) return;
        
        requestAnimationFrame(draw);
        analyser.getByteFrequencyData(dataArray);
        
        canvasCtx.fillStyle = 'rgba(20, 20, 20, 0.95)';
        canvasCtx.fillRect(0, 0, width, height);
        
        const barWidth = (width / bufferLength) * 2.5;
        let barHeight;
        let x = 0;
        
        for (let i = 0; i < bufferLength; i++) {
            barHeight = (dataArray[i] / 255) * height;
            
            const gradient = canvasCtx.createLinearGradient(0, height, 0, height - barHeight);
            gradient.addColorStop(0, '#ff3366');
            gradient.addColorStop(1, '#ff1a4d');
            
            canvasCtx.fillStyle = gradient;
            canvasCtx.fillRect(x, height - barHeight, barWidth, barHeight);
            
            x += barWidth + 1;
        }
    }
    
    draw();
} 