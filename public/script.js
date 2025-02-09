// Initialize Socket.IO with proper error handling
const socket = io({
    reconnection: true,
    reconnectionAttempts: 5,
    reconnectionDelay: 1000,
    path: '/socket.io',
    transports: ['websocket', 'polling']
});

// DOM Elements
const liveMessages = document.getElementById('live-messages');
const liveQuestion = document.getElementById('live-question');
const queueStatus = document.getElementById('queue-status');
const listenerCount = document.getElementById('listener-count');
const slotsAvailable = document.getElementById('slots-available');
const mainPlayButton = document.getElementById('main-play-button');
const nowPlaying = document.getElementById('now-playing');
const messagesContainer = document.querySelector('.messages-container');
const nameInput = document.getElementById('name-input');
const messageInput = document.getElementById('message-input');
const sendButton = document.querySelector('.send-button');
const visualizationCanvas = document.getElementById('visualization-canvas');
const sphereCanvas = document.getElementById('sphere-animation');
const competitionStatus = document.getElementById('competition-status');
const competitionTimer = document.getElementById('competition-timer');

// Track current audio state
let currentAudio = null;
let currentAudioElement = null;
let isRadioPlaying = false;
let messageCount = 0;
const MAX_MESSAGES = 10;

// Competition state
let competitionEndTime = null;
let competitionInterval = null;

// Track current audio state and processed responses
let processedResponses = new Set(); // Track processed responses

// Track audio state
let audioEnabled = false;
let pendingAudioMessages = [];
let currentlyPlaying = false;

// Add local storage for audio state persistence
const AUDIO_ENABLED_KEY = 'audioEnabled';
audioEnabled = localStorage.getItem(AUDIO_ENABLED_KEY) === 'true';

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    initializeMessageHandling();
    initializeCompetitionUI();
    initializeAudio();
    addAudioEnableButton();
});

let messageQueue = [];
let isProcessing = false;
let deviceId = localStorage.getItem('deviceId') || 'device_' + Math.random().toString(36).substr(2, 9);
localStorage.setItem('deviceId', deviceId);

// Three.js Scene Setup - Only initialize if canvas exists
if (sphereCanvas) {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(75, sphereCanvas.clientWidth / sphereCanvas.clientHeight, 0.1, 1000);
    const renderer = new THREE.WebGLRenderer({ canvas: sphereCanvas, alpha: true });
    renderer.setSize(sphereCanvas.clientWidth, sphereCanvas.clientHeight);
    
    // Create Sphere
    const geometry = new THREE.IcosahedronGeometry(1, 2);
    const material = new THREE.MeshPhongMaterial({
        color: 0x00f0ff,
        wireframe: true,
        transparent: true,
        opacity: 0.8
    });
    const sphere = new THREE.Mesh(geometry, material);
    scene.add(sphere);
    
    // Add Lights
    const light = new THREE.PointLight(0xff3366, 1, 100);
    light.position.set(10, 10, 10);
    scene.add(light);
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    scene.add(ambientLight);
    
    camera.position.z = 2.5;
    
    // Animation Variables
    let targetRotation = { x: 0, y: 0 };
    const rotationSpeed = 0.01;
    let pulseScale = 1;
    const pulseSpeed = 0.02;
    
    // Animation Loop
    function animate() {
        requestAnimationFrame(animate);
        
        // Rotate sphere
        sphere.rotation.x += (targetRotation.x - sphere.rotation.x) * rotationSpeed;
        sphere.rotation.y += (targetRotation.y - sphere.rotation.y) * rotationSpeed;
        
        // Pulse effect
        pulseScale += Math.sin(Date.now() * 0.001) * pulseSpeed;
        sphere.scale.set(pulseScale, pulseScale, pulseScale);
        
        renderer.render(scene, camera);
    }
    
    // Start animation
    animate();
    
    // Event Listeners
    sphereCanvas.addEventListener('mousemove', (e) => {
        const rect = sphereCanvas.getBoundingClientRect();
        targetRotation.x = ((e.clientY - rect.top) / sphereCanvas.clientHeight - 0.5) * Math.PI;
        targetRotation.y = ((e.clientX - rect.left) / sphereCanvas.clientWidth - 0.5) * Math.PI;
    });
}

// Visualization Setup
const ctx = visualizationCanvas ? visualizationCanvas.getContext('2d') : null;
let visualizationData = [];
const maxDataPoints = 100;

// Input Effects
messageInput.addEventListener('mousemove', (e) => {
    const rect = messageInput.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    messageInput.style.setProperty('--x', `${x}px`);
    messageInput.style.setProperty('--y', `${y}px`);
});

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

// Initialize competition UI
function initializeCompetitionUI() {
    const competitionSection = document.createElement('div');
    competitionSection.className = 'competition-section';
    competitionSection.innerHTML = `
        <div class="competition-header">
            <h2>Message Competition</h2>
            <div id="competition-status">Waiting for messages...</div>
            <div id="competition-timer"></div>
        </div>
        <div class="competition-rules">
            <p>Submit your message to compete! The most interesting message will be chosen and responded to by Kaia.</p>
            <ul>
                <li>Messages are scored based on creativity and engagement</li>
                <li>Competition rounds last 30 seconds</li>
                <li>Winners get special responses from Kaia</li>
            </ul>
        </div>
    `;
    
    document.querySelector('.interaction-zone').prepend(competitionSection);
}

// Update competition timer
function updateCompetitionTimer() {
    if (!competitionEndTime) return;
    
    const now = Date.now();
    const timeLeft = Math.max(0, competitionEndTime - now);
    
    if (timeLeft === 0) {
        if (competitionTimer) {
            competitionTimer.textContent = 'Selecting winner...';
        }
        return;
    }
    
    const seconds = Math.ceil(timeLeft / 1000);
    if (competitionTimer) {
        competitionTimer.textContent = `Time remaining: ${seconds}s`;
    }
}

// Handle competition start without system message
socket.on('competition-start', (data) => {
    competitionEndTime = data.endTime;
    
    if (competitionStatus) {
        competitionStatus.textContent = 'Competition Active! Submit your message now!';
        competitionStatus.className = 'status-active';
    }
    
    if (competitionInterval) {
        clearInterval(competitionInterval);
    }
    
    competitionInterval = setInterval(updateCompetitionTimer, 100);
});

// Socket event for listener count updates
socket.on('listener-count', (count) => {
    if (listenerCount) {
        listenerCount.textContent = count;
    }
});

// Handle competition winner with audio
socket.on('competition-winner', (data) => {
    console.log('Received competition winner:', data);
    
    // Generate a unique response ID
    const responseId = `${data.message}-${data.timestamp}`;
    
    // Don't process if this response was already handled
    if (processedResponses.has(responseId)) {
        console.log('Skipping duplicate response:', responseId);
        return;
    }
    
    // Add to processed responses
    processedResponses.add(responseId);
    
    // Add winner announcement to messages container
    const winnerMessage = document.createElement('div');
    winnerMessage.className = 'message winner-message';
    winnerMessage.dataset.messageId = String(data.timestamp);
    winnerMessage.dataset.responseId = responseId;
    winnerMessage.innerHTML = `
        <div class="winner-banner">
            🏆 Winning Message!
            <div class="score">Score: ${Math.round(data.score * 10) / 10}</div>
        </div>
        <div class="message-content">
            <strong>${data.userName || 'Anonymous'}</strong>: ${data.message}
        </div>
        <div class="kaia-response">
            <div class="response-header">
                <span class="ai-indicator">🎙️ Kaia's Response:</span>
            </div>
            ${data.response}
        </div>
    `;
    
    if (messagesContainer) {
        messagesContainer.prepend(winnerMessage);
        winnerMessage.scrollIntoView({ behavior: 'smooth' });
    }

    // Play audio response if available
    if (data.audioUrl && !currentlyPlaying) {
        playAudioResponse(data.audioUrl, data.response);
    }
});

// Cleanup processed responses periodically to prevent memory leaks
setInterval(() => {
    const oneHourAgo = Date.now() - (60 * 60 * 1000);
    processedResponses.clear(); // Clear old responses every hour
}, 60 * 60 * 1000);

// Handle competition state
socket.on('competition-state', (data) => {
    if (data.isActive) {
        competitionEndTime = data.endTime;
        if (competitionStatus) {
            competitionStatus.textContent = 'Competition Active!';
            competitionStatus.className = 'status-active';
        }
        if (competitionInterval) {
            clearInterval(competitionInterval);
        }
        competitionInterval = setInterval(updateCompetitionTimer, 100);
    }
});

// Handle message errors
socket.on('message-error', (data) => {
    if (!data.message.includes('Starting new competition')) {
        addSystemMessage(data.message, 'error');
    }
});

// Initialize message handling
function initializeMessageHandling() {
    // Handle new messages
    socket.on('new-message', (data) => {
        console.log('Received new message:', data);
        addMessage(data, data.userId === localStorage.getItem('deviceId'));
    });

    // Handle audio playback command
    socket.on('play-audio', (data) => {
        console.log('Received audio playback command:', data);
        if (data.audioPath && !processedResponses.has(data.audioPath)) {
            processedResponses.add(data.audioPath);
            playAudioResponse(data.audioPath, data.text);
        }
    });

    // Handle audio playback completion
    socket.on('audio-playback-complete', (data) => {
        console.log('Audio playback completed:', data);
        if (nowPlaying) {
            nowPlaying.innerHTML = '';
        }
    });

    // Handle form submission
    const messageForm = document.getElementById('message-form');
    if (messageForm) {
        messageForm.addEventListener('submit', (e) => {
            e.preventDefault();
            
            const name = nameInput.value.trim();
            const message = messageInput.value.trim();
            
            if (name && message) {
                const messageData = {
                    userName: name,
                    message: message,
                    userId: localStorage.getItem('deviceId') || generateDeviceId(),
                    timestamp: Date.now()
                };
                
                socket.emit('send-message', messageData);
                messageInput.value = '';
                
                // Save name in localStorage
                localStorage.setItem('userName', name);
            }
        });
    }
}

// Generate a unique device ID if not exists
function generateDeviceId() {
    let deviceId = localStorage.getItem('deviceId');
    if (!deviceId) {
        deviceId = 'device_' + Math.random().toString(36).substr(2, 9);
        localStorage.setItem('deviceId', deviceId);
    }
    return deviceId;
}

// Add message to UI
function addMessage(data, isUser = false) {
    if (!messagesContainer) return;
    
    // Don't display duplicate messages
    const existingMessages = messagesContainer.querySelectorAll('.message');
    for (const msg of existingMessages) {
        if (msg.dataset.messageId === String(data.timestamp)) {
            return; // Skip if message already exists
        }
    }
    
    const messageElement = document.createElement('div');
    messageElement.className = `message ${isUser ? 'user-message' : ''} ${data.isCompeting ? 'competing-message' : ''}`;
    messageElement.dataset.messageId = String(data.timestamp); // Add unique identifier
    
    // Handle message content properly
    const messageText = typeof data === 'string' ? data : data.message;
    const userName = typeof data === 'string' ? (isUser ? nameInput.value || 'Anonymous' : 'Kaia') : (data.userName || 'Anonymous');
    
    // Format the message content properly
    let content = `
        ${data.isCompeting ? '<div class="competing-badge">🎯 Competing</div>' : ''}
        <div class="message-content">
            <strong>${userName}</strong>: ${messageText}
        </div>
        <div class="message-meta">
            <span class="timestamp">${new Date(data.timestamp || Date.now()).toLocaleTimeString()}</span>
            ${data.score ? `<span class="score">Score: ${Math.round(data.score * 10) / 10}</span>` : ''}
        </div>
    `;
    
    messageElement.innerHTML = content;
    messagesContainer.prepend(messageElement);
    messageElement.scrollIntoView({ behavior: 'smooth' });
}

// Add a system message
function addSystemMessage(message, type = '') {
    const systemMessage = document.createElement('div');
    systemMessage.className = `system-message ${type}`;
    systemMessage.textContent = message;
    messagesContainer.prepend(systemMessage);
    systemMessage.scrollIntoView({ behavior: 'smooth' });
}

// Modify socket event handlers to remove unnecessary messages
socket.on('connect', () => {
    console.log('Connected to server');
});

socket.on('disconnect', () => {
    console.log('Disconnected from server');
});

socket.on('connect_error', (error) => {
    console.error('Socket connection error:', error);
});

// Only initialize visualization if canvas exists
function updateVisualization(value) {
    if (!ctx) return;  // Skip if canvas or context is not available
    
    visualizationData.push(value);
    if (visualizationData.length > maxDataPoints) {
        visualizationData.shift();
    }
    
    drawVisualization();
}

function drawVisualization() {
    if (!ctx || !visualizationCanvas) return;  // Skip if canvas or context is not available
    
    const width = visualizationCanvas.width;
    const height = visualizationCanvas.height;
    
    ctx.clearRect(0, 0, width, height);
    ctx.strokeStyle = '#00f0ff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    
    const step = width / maxDataPoints;
    const scale = height / Math.max(...visualizationData, 50);
    
    visualizationData.forEach((value, index) => {
        const x = index * step;
        const y = height - (value * scale);
        
        if (index === 0) {
            ctx.moveTo(x, y);
        } else {
            ctx.lineTo(x, y);
        }
    });
    
    ctx.stroke();
}

// Animation Loop
function animate() {
    requestAnimationFrame(animate);
    
    // Rotate sphere
    sphere.rotation.x += (targetRotation.x - sphere.rotation.x) * rotationSpeed;
    sphere.rotation.y += (targetRotation.y - sphere.rotation.y) * rotationSpeed;
    
    // Pulse effect
    pulseScale += Math.sin(Date.now() * 0.001) * pulseSpeed;
    sphere.scale.set(pulseScale, pulseScale, pulseScale);
    
    // Rotate particles
    particleSystem.rotation.y += 0.001;
    
    renderer.render(scene, camera);
}

// Event Listeners
sphereCanvas.addEventListener('mousemove', (e) => {
    const rect = sphereCanvas.getBoundingClientRect();
    targetRotation.x = ((e.clientY - rect.top) / sphereCanvas.clientHeight - 0.5) * Math.PI;
    targetRotation.y = ((e.clientX - rect.left) / sphereCanvas.clientWidth - 0.5) * Math.PI;
});

// Initialize
animate();

// Resize handling
window.addEventListener('resize', () => {
    // Update Three.js canvas
    camera.aspect = sphereCanvas.clientWidth / sphereCanvas.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(sphereCanvas.clientWidth, sphereCanvas.clientHeight);
    
    // Update visualization canvas
    visualizationCanvas.width = visualizationCanvas.clientWidth;
    visualizationCanvas.height = visualizationCanvas.clientHeight;
    drawVisualization();
});

// Add competition-specific styles
const style = document.createElement('style');
style.textContent = `
    .competition-section {
        background: rgba(255, 255, 255, 0.05);
        border-radius: 12px;
        padding: 20px;
        margin-bottom: 20px;
    }

    .competition-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 15px;
    }

    .competition-header h2 {
        color: var(--primary-color);
        margin: 0;
    }

    #competition-status {
        padding: 8px 16px;
        border-radius: 20px;
        font-size: 0.9em;
    }

    #competition-status.status-active {
        background: rgba(0, 255, 0, 0.1);
        color: #00ff00;
    }

    #competition-status.status-waiting {
        background: rgba(255, 255, 0, 0.1);
        color: #ffff00;
    }

    #competition-timer {
        font-family: monospace;
        font-size: 1.2em;
        color: var(--primary-color);
    }

    .competition-rules {
        background: rgba(255, 255, 255, 0.03);
        padding: 15px;
        border-radius: 8px;
    }

    .competition-rules ul {
        list-style-type: none;
        padding: 0;
        margin: 10px 0 0;
    }

    .competition-rules li {
        margin: 5px 0;
        padding-left: 20px;
        position: relative;
    }

    .competition-rules li:before {
        content: '→';
        position: absolute;
        left: 0;
        color: var(--primary-color);
    }

    .competing-badge {
        background: var(--primary-color);
        color: black;
        padding: 4px 8px;
        border-radius: 12px;
        font-size: 0.8em;
        display: inline-block;
        margin-bottom: 8px;
    }

    .message-score {
        font-size: 0.9em;
        color: var(--primary-color);
        margin-top: 8px;
    }

    .winner-message {
        background: linear-gradient(135deg, rgba(255, 215, 0, 0.1), rgba(255, 140, 0, 0.1));
        border: 1px solid rgba(255, 215, 0, 0.3);
        padding: 20px;
        margin: 20px 0;
        border-radius: 12px;
    }

    .winner-banner {
        background: linear-gradient(90deg, #ffd700, #ffa500);
        color: black;
        padding: 8px 16px;
        border-radius: 20px;
        font-weight: bold;
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 15px;
    }

    .winner-banner .score {
        background: rgba(0, 0, 0, 0.1);
        padding: 4px 8px;
        border-radius: 12px;
        font-size: 0.9em;
    }

    .kaia-response {
        margin-top: 15px;
        padding: 15px;
        background: rgba(255, 255, 255, 0.05);
        border-radius: 8px;
    }

    .response-header {
        margin-bottom: 10px;
        color: var(--primary-color);
    }

    .system-message.competition-start {
        background: linear-gradient(90deg, rgba(0, 240, 255, 0.1), rgba(255, 51, 102, 0.1));
        color: var(--primary-color);
        font-weight: bold;
    }
`;
document.head.appendChild(style);

// Initialize audio playback with iOS support
let audioContext = null;
let audioInitialized = false;
let responseAudio = null; // Global audio element

// Function to initialize audio
function initializeAudio() {
    // Create a persistent audio element
    responseAudio = document.createElement('audio');
    responseAudio.id = 'response-audio';
    responseAudio.setAttribute('playsinline', '');
    responseAudio.setAttribute('webkit-playsinline', '');
    responseAudio.preload = 'auto';
    document.body.appendChild(responseAudio);

    // Add audio context initialization on user interaction
    document.addEventListener('touchstart', initializeAudioContext, { once: true });
    document.addEventListener('click', initializeAudioContext, { once: true });
}

// Function to initialize audio context
async function initializeAudioContext() {
    try {
        console.log('Initializing audio context...');
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        
        // Create new context if it doesn't exist or is closed
        if (!audioContext || audioContext.state === 'closed') {
            audioContext = new AudioContext();
            console.log('Created new AudioContext, state:', audioContext.state);
        }
        
        // For iOS, we need to resume the context after user interaction
        if (audioContext.state === 'suspended') {
            console.log('Resuming suspended AudioContext...');
            await audioContext.resume();
            console.log('AudioContext resumed, new state:', audioContext.state);
        }
        
        // Create and play a silent buffer (important for iOS)
        const silentBuffer = audioContext.createBuffer(1, 1, 22050);
        const source = audioContext.createBufferSource();
        source.buffer = silentBuffer;
        source.connect(audioContext.destination);
        source.start(0);
        source.stop(0.001); // Extremely short duration

        // Try to play a silent audio file (important for iOS)
        if (responseAudio) {
            responseAudio.src = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA';
            try {
                await responseAudio.play();
                responseAudio.pause();
            } catch (e) {
                console.log('Silent audio play failed (expected):', e);
            }
        }
        
        audioInitialized = true;
        audioEnabled = true;
        localStorage.setItem(AUDIO_ENABLED_KEY, 'true');
        
        return true;
    } catch (error) {
        console.error('Error initializing audio context:', error);
        return false;
    }
}

// Enhanced audio playback function with better iOS support
async function playAudioResponse(audioUrl, text) {
    if (!audioUrl) return;
    
    console.log('Attempting to play audio:', { audioUrl, audioEnabled, currentlyPlaying, audioInitialized });
    
    if (!audioEnabled) {
        console.log('Audio not enabled, queueing message');
        pendingAudioMessages.push({ audioUrl, text });
        return;
    }
    
    try {
        // Initialize audio context if needed
        if (!audioInitialized) {
            console.log('Audio not initialized, attempting initialization...');
            const initialized = await initializeAudioContext();
            if (!initialized) {
                console.error('Failed to initialize audio context');
                return;
            }
        }
        
        // Wait for previous audio to finish if any
        if (currentlyPlaying) {
            console.log('Audio already playing, queueing message');
            pendingAudioMessages.push({ audioUrl, text });
            return;
        }
        
        currentlyPlaying = true;
        
        // Use the persistent audio element
        responseAudio.pause();
        responseAudio.currentTime = 0;
        
        // Important for iOS
        responseAudio.preload = 'auto';
        responseAudio.playsInline = true;
        responseAudio.setAttribute('webkit-playsinline', '');
        
        // Set up event listeners
        const playAudioPromise = new Promise((resolve, reject) => {
            responseAudio.oncanplay = async () => {
                console.log('Audio can play, attempting playback...');
                try {
                    // For iOS, try to resume audio context before playing
                    if (audioContext && audioContext.state === 'suspended') {
                        console.log('Resuming audio context before playback...');
                        await audioContext.resume();
                    }
                    
                    const playPromise = responseAudio.play();
                    if (playPromise !== undefined) {
                        playPromise.then(() => {
                            console.log('Audio playing successfully');
                            resolve();
                        }).catch(async error => {
                            console.error('Error during audio playback:', error);
                            if (error.name === 'NotAllowedError') {
                                // Try to reinitialize audio
                                await initializeAudioContext();
                                // Retry playback
                                responseAudio.play().catch(e => {
                                    console.error('Retry playback failed:', e);
                                    reject(e);
                                });
                            } else {
                                reject(error);
                            }
                        });
                    }
                } catch (error) {
                    reject(error);
                }
            };
            
            responseAudio.onerror = (e) => {
                console.error('Audio error:', e);
                reject(e);
            };
        });
        
        // Set source and load
        const fullUrl = audioUrl.startsWith('http') ? audioUrl : window.location.origin + audioUrl;
        console.log('Loading audio from URL:', fullUrl);
        responseAudio.src = fullUrl;
        responseAudio.load();
        
        try {
            await playAudioPromise;
            console.log('Audio playback completed successfully');
        } catch (error) {
            console.error('Error during audio playback:', error);
            // Handle the error by queueing the message
            pendingAudioMessages.push({ audioUrl, text });
        } finally {
            currentlyPlaying = false;
            
            // Play next message if available
            if (audioEnabled && pendingAudioMessages.length > 0) {
                const nextMessage = pendingAudioMessages.shift();
                playAudioResponse(nextMessage.audioUrl, nextMessage.text);
            }
        }
        
    } catch (error) {
        console.error('Error setting up audio playback:', error);
        currentlyPlaying = false;
    }
}

// Add floating audio enable button for iOS
function addAudioEnableButton() {
    const button = document.createElement('button');
    button.id = 'enable-audio-button';
    button.innerHTML = audioEnabled ? '🔊' : '🔇';
    button.className = 'floating-audio-button' + (!audioEnabled ? ' disabled' : '');
    button.setAttribute('aria-label', audioEnabled ? 'Mute Audio' : 'Enable Audio');
    
    button.onclick = async () => {
        try {
            if (!audioEnabled) {
                console.log('Attempting to enable audio...');
                // Close existing context if it exists
                if (audioContext) {
                    await audioContext.close();
                    audioContext = null;
                }
                audioInitialized = false;
                
                const success = await initializeAudioContext();
                if (success) {
                    console.log('Audio initialization successful');
                    audioEnabled = true;
                    localStorage.setItem(AUDIO_ENABLED_KEY, 'true');
                    button.innerHTML = '🔊';
                    button.classList.remove('disabled');
                    button.setAttribute('aria-label', 'Mute Audio');
                    
                    // Try to play any pending messages
                    if (pendingAudioMessages.length > 0) {
                        const nextMessage = pendingAudioMessages.shift();
                        await playAudioResponse(nextMessage.audioUrl, nextMessage.text);
                    }
                } else {
                    console.error('Failed to initialize audio');
                }
            } else {
                console.log('Disabling audio...');
                audioEnabled = false;
                localStorage.setItem(AUDIO_ENABLED_KEY, 'false');
                button.innerHTML = '🔇';
                button.classList.add('disabled');
                button.setAttribute('aria-label', 'Enable Audio');
                
                // Clean up current audio
                if (responseAudio) {
                    responseAudio.pause();
                    responseAudio.currentTime = 0;
                }
                if (audioContext) {
                    await audioContext.close();
                    audioContext = null;
                }
                audioInitialized = false;
                currentlyPlaying = false;
                // Clear pending messages when audio is disabled
                pendingAudioMessages = [];
            }
        } catch (error) {
            console.error('Error toggling audio:', error);
        }
    };
    
    document.body.appendChild(button);
}

// Handle audio completion
responseAudio.addEventListener('ended', () => {
    if (nowPlaying) {
        nowPlaying.innerHTML = '';
    }
    currentAudioUrl = null;
    currentAudioText = null;
    socket.emit('audio-complete');
});

// Handle audio playback events
socket.on('play-audio', (data) => {
    if (data.audioPath && data.text) {
        playAudioResponse(data.audioPath, data.text);
    }
}); 