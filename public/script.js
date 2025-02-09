// Initialize Socket.IO with proper error handling
const socket = io({
    reconnection: true,
    reconnectionAttempts: 5,
    reconnectionDelay: 1000,
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

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    initializeMessageHandling();
    initializeCompetitionUI();
});

let messageQueue = [];
let isProcessing = false;
let deviceId = localStorage.getItem('deviceId') || 'device_' + Math.random().toString(36).substr(2, 9);
localStorage.setItem('deviceId', deviceId);

// Three.js Scene Setup
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

// Particle System
const particlesGeometry = new THREE.BufferGeometry();
const particleCount = 1000;
const positions = new Float32Array(particleCount * 3);

for (let i = 0; i < particleCount * 3; i += 3) {
    positions[i] = (Math.random() - 0.5) * 10;
    positions[i + 1] = (Math.random() - 0.5) * 10;
    positions[i + 2] = (Math.random() - 0.5) * 10;
}

particlesGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
const particlesMaterial = new THREE.PointsMaterial({
    color: 0x00f0ff,
    size: 0.02,
    transparent: true,
    opacity: 0.5
});

const particleSystem = new THREE.Points(particlesGeometry, particlesMaterial);
scene.add(particleSystem);

// Visualization Setup
const ctx = visualizationCanvas.getContext('2d');
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

// Handle competition start
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
    
    // Add competition announcement to messages
    addSystemMessage('🎯 New competition round started! Submit your message to compete!', 'competition-start');
});

// Handle competition winner
socket.on('competition-winner', (data) => {
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
    winnerMessage.innerHTML = `
        <div class="winner-banner">
            🏆 Winning Message!
            <div class="score">Score: ${Math.round(data.score * 10) / 10}</div>
        </div>
        <div class="message-content">
            <strong>${data.userName}</strong>: ${data.message}
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
});

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
    addSystemMessage(data.message, 'error');
});

// Initialize message handling
function initializeMessageHandling() {
    const messageForm = document.getElementById('message-form');
    
    if (!messageForm || !messageInput || !nameInput) {
        console.error('Required form elements not found!');
        return;
    }
    
    messageForm.addEventListener('submit', function(e) {
        e.preventDefault();
        
        const message = messageInput.value.trim();
        const name = nameInput.value.trim() || 'Anonymous';
        
        if (message) {
            const messageId = Date.now().toString();
            const messageData = {
                message: message,
                userId: localStorage.getItem('userId') || 'user-' + messageId,
                userName: name,
                messageId: messageId,
                timestamp: Date.now()
            };
            
            // Add user message to the feed
            addMessage(messageData, true);
            
            // Send message to server
            socket.emit('send-message', messageData);
            
            // Clear input
            messageInput.value = '';
            messageInput.focus();
        }
    });
}

// Add a message to the feed
function addMessage(data, isUser = false) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${isUser ? 'user-message' : 'ai-message'}`;
    
    if (data.isCompeting) {
        messageDiv.innerHTML = `
            <div class="competing-badge">🎯 Competing</div>
            <div class="message-content">
                <strong>${data.userName}</strong>: ${data.message}
            </div>
            ${data.score ? `
                <div class="message-score">
                    Score: ${Math.round(data.score * 10) / 10}
                </div>
            ` : ''}
        `;
    } else {
        messageDiv.innerHTML = `
            <div class="message-content">
                <strong>${data.userName}</strong>: ${data.message}
            </div>
        `;
    }
    
    messagesContainer.prepend(messageDiv);
    messageDiv.scrollIntoView({ behavior: 'smooth' });
}

// Add a system message
function addSystemMessage(message, type = '') {
    const systemMessage = document.createElement('div');
    systemMessage.className = `system-message ${type}`;
    systemMessage.textContent = message;
    messagesContainer.prepend(systemMessage);
    systemMessage.scrollIntoView({ behavior: 'smooth' });
}

// Socket event handlers
socket.on('connect', () => {
    addSystemMessage('Connected to server', 'success');
});

socket.on('disconnect', () => {
    addSystemMessage('Disconnected from server. Attempting to reconnect...', 'error');
});

socket.on('error', (error) => {
    addSystemMessage(error.message, 'error');
});

// Message Handling
function addMessage(message, isUser = false) {
    const messageElement = document.createElement('div');
    messageElement.classList.add('message', isUser ? 'user-message' : 'ai-message');
    
    const header = document.createElement('div');
    header.classList.add('message-header');
    
    const name = document.createElement('span');
    name.textContent = isUser ? nameInput.value || 'User' : 'Kaia';
    header.appendChild(name);
    
    const time = document.createElement('span');
    time.textContent = new Date().toLocaleTimeString();
    header.appendChild(time);
    
    const content = document.createElement('div');
    content.classList.add('message-content');
    content.textContent = message;
    
    messageElement.appendChild(header);
    messageElement.appendChild(content);
    
    messagesContainer.appendChild(messageElement);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
    
    // Update visualization data
    updateVisualization(message.length);
}

function updateVisualization(value) {
    visualizationData.push(value);
    if (visualizationData.length > maxDataPoints) {
        visualizationData.shift();
    }
    
    drawVisualization();
}

function drawVisualization() {
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

sendButton.addEventListener('click', () => {
    const message = messageInput.value.trim();
    if (message) {
        socket.emit('chat message', {
            name: nameInput.value || 'User',
            message: message
        });
        addMessage(message, true);
        messageInput.value = '';
    }
});

messageInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendButton.click();
    }
});

// Socket Events
socket.on('chat message', (data) => {
    if (data.name !== (nameInput.value || 'User')) {
        addMessage(data.message);
    }
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