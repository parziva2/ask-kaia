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

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    initializeMessageHandling();
    initializeCompetitionUI();
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

// Handle competition winner with debug logging and duplicate prevention
socket.on('competition-winner', (data) => {
    console.log('Received competition winner:', data);  // Debug log
    
    // Generate a unique response ID using message content and timestamp
    const responseId = `${data.message}-${data.timestamp}`;
    
    // Don't process if this response was already handled
    if (processedResponses.has(responseId)) {
        console.log('Skipping duplicate response:', responseId);
        return;
    }
    
    // Add to processed responses
    processedResponses.add(responseId);
    
    // Don't process if this winner was already announced
    const existingWinners = messagesContainer.querySelectorAll('.winner-message');
    for (const winner of existingWinners) {
        if (winner.dataset.messageId === String(data.timestamp)) {
            return; // Skip if winner already announced
        }
    }
    
    competitionEndTime = null;
    if (competitionInterval) {
        clearInterval(competitionInterval);
    }
    
    if (competitionStatus) {
        competitionStatus.textContent = 'Winner selected! Next round starting soon...';
        competitionStatus.className = 'status-waiting';
    }
    
    // Add winner announcement
    const winnerMessage = document.createElement('div');
    winnerMessage.className = 'message winner-message';
    winnerMessage.dataset.messageId = String(data.timestamp);
    winnerMessage.dataset.responseId = responseId; // Add response ID to DOM
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
    
    messagesContainer.prepend(winnerMessage);
    winnerMessage.scrollIntoView({ behavior: 'smooth' });

    // Play audio response if available and not already played
    if (data.audioUrl && !processedResponses.has(data.audioUrl)) {
        processedResponses.add(data.audioUrl);
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
    const messageForm = document.getElementById('message-form');
    const messageInput = document.getElementById('message-input');
    const nameInput = document.getElementById('name-input');
    
    if (!messageForm || !messageInput || !nameInput) {
        console.error('Required form elements not found!');
        return;
    }
    
    messageForm.addEventListener('submit', function(e) {
        e.preventDefault();
        
        const message = messageInput.value.trim();
        const name = nameInput.value.trim() || 'Anonymous';
        
        if (message) {
            const timestamp = Date.now();
            // Create message data object
            const messageData = {
                message: message,
                userName: name,
                userId: localStorage.getItem('deviceId') || 'anonymous',
                timestamp: timestamp
            };
            
            // Add message to UI immediately
            addMessage(messageData, true);
            
            // Send message to server
            socket.emit('send-message', messageData);
            
            // Clear input
            messageInput.value = '';
            messageInput.focus();
        }
    });

    // Add keypress event listener for Enter key
    messageInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            messageForm.dispatchEvent(new Event('submit'));
        }
    });
}

// Handle incoming messages with debug logging
socket.on('new-message', (data) => {
    console.log('Received new message:', data);  // Debug log
    // Only add the message if it's not from the current user
    if (data.userId !== localStorage.getItem('deviceId')) {
        addMessage(data);
    }
});

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

// Initialize audio elements
const responseAudio = document.getElementById('response-audio');
const enableAudioButton = document.getElementById('enable-audio');
let audioContext = null;
let audioInitialized = false;

// Function to initialize audio
function initializeAudio() {
    if (audioInitialized) return;
    
    try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        audioContext = new AudioContext();
        
        // Show enable audio button on iOS
        if (audioContext.state === 'suspended') {
            enableAudioButton.style.display = 'block';
        }
        
        audioInitialized = true;
        console.log('Audio initialized successfully');
    } catch (error) {
        console.error('Error initializing audio:', error);
    }
}

// Handle enable audio button click
enableAudioButton.addEventListener('click', async () => {
    try {
        if (audioContext && audioContext.state === 'suspended') {
            await audioContext.resume();
        }
        enableAudioButton.style.display = 'none';
        console.log('Audio context resumed');
    } catch (error) {
        console.error('Error enabling audio:', error);
    }
});

// Initialize audio on first user interaction
document.addEventListener('touchstart', initializeAudio, { once: true });
document.addEventListener('click', initializeAudio, { once: true });

// Handle audio playback
function playAudioResponse(audioUrl, text) {
    if (!audioUrl) return;
    
    // Initialize audio if not already done
    if (!audioInitialized) {
        initializeAudio();
    }
    
    // Update UI
    nowPlaying.innerHTML = `🎙️ Loading: ${text || ''}`;
    
    // Configure audio element
    responseAudio.src = audioUrl.startsWith('http') ? audioUrl : `${window.location.origin}${audioUrl}`;
    responseAudio.load();
    
    // Play audio with error handling
    const playPromise = responseAudio.play();
    if (playPromise !== undefined) {
        playPromise.then(() => {
            console.log('Audio playing successfully');
            nowPlaying.innerHTML = `🎙️ Now Playing: ${text || ''}`;
        }).catch(error => {
            console.error('Error playing audio:', error);
            nowPlaying.innerHTML = '❌ Tap to retry audio';
            nowPlaying.onclick = () => playAudioResponse(audioUrl, text);
        });
    }
}

// Handle audio completion
responseAudio.addEventListener('ended', () => {
    nowPlaying.innerHTML = '';
    socket.emit('audio-complete');
});

// Handle audio playback events
socket.on('play-audio', (data) => {
    if (data.audioPath && data.text) {
        playAudioResponse(data.audioPath, data.text);
    }
}); 