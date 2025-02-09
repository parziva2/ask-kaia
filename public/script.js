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

// Track current audio state
let currentAudio = null;
let currentAudioElement = null;
let isRadioPlaying = false;
let messageCount = 0;
const MAX_MESSAGES = 10;

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    initializeMessageHandling();
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

// Add a system message
function addSystemMessage(message, type = '') {
    const messagesDiv = ensureMessagesContainer();
    const systemMessage = document.createElement('div');
    systemMessage.className = `system-message ${type}`;
    systemMessage.textContent = message;
    messagesDiv.appendChild(systemMessage);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

// Initialize message handling
function initializeMessageHandling() {
    const messageForm = document.getElementById('message-form');
    const nameInput = document.getElementById('name-input');

    if (!messageForm || !messageInput || !nameInput) {
        console.error('Required form elements not found!');
        return;
    }

    // Handle form submission
    messageForm.addEventListener('submit', function(e) {
        e.preventDefault();
        console.log('Form submitted');
        
        const message = messageInput.value.trim();
        const name = nameInput.value.trim() || 'Anonymous';
        
        if (message) {
            console.log('Sending message:', message);
            const messageId = Date.now().toString();
            const messageData = {
                message: message,
                userId: localStorage.getItem('userId') || 'user-' + messageId,
                userName: name,
                messageId: messageId,
                deviceId: deviceId,
                timestamp: new Date().toISOString()
            };

            // Add user message to the feed immediately
            const messagesDiv = ensureMessagesContainer();
            const userMessageDiv = document.createElement('div');
            userMessageDiv.className = 'message user-message';
            userMessageDiv.innerHTML = `
                <div class="message-header">
                    <strong style="color: #3399ff">${name}</strong>
                    <span class="timestamp">${new Date().toLocaleTimeString([], { 
                        hour: '2-digit', 
                        minute: '2-digit',
                        hour12: true 
                    }).toUpperCase()}</span>
                </div>
                <div class="message-content">${message}</div>
            `;
            messagesDiv.appendChild(userMessageDiv);
            messagesDiv.scrollTop = messagesDiv.scrollHeight;

            // Send message to server
            if (socket.connected) {
                console.log('Socket connected, sending message directly');
                socket.emit('send-message', messageData, (error) => {
                    if (error) {
                        console.error('Error sending message:', error);
                        addSystemMessage('Error sending message. Please try again.', 'error');
                    } else {
                        console.log('Message sent successfully');
                        messageInput.value = '';
                        messageInput.focus();
                    }
                });
            } else {
                console.log('Socket not connected, queueing message');
                messageQueue.push(messageData);
                messageInput.value = '';
                messageInput.focus();
                addSystemMessage('Message queued. Waiting for connection...', 'info');
            }
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
}

// Socket event handlers with improved logging
socket.on('connect', () => {
    console.log('Connected to server successfully');
    addSystemMessage('Connected to server', 'success');
    processMessageQueue();
});

socket.on('connect_error', (error) => {
    console.error('Connection error:', error);
    addSystemMessage('Connection error. Retrying...', 'error');
    
    if (socket.io.engine?.transport?.name === 'websocket') {
        console.log('Falling back to polling transport');
        socket.io.opts.transports = ['polling'];
    }
});

socket.on('disconnect', (reason) => {
    console.log('Disconnected from server:', reason);
    addSystemMessage('Disconnected from server. Attempting to reconnect...', 'error');
    
    if (!socket.connected) {
        setTimeout(() => {
            console.log('Attempting to reconnect...');
            socket.connect();
        }, 2000);
    }
});

// Handle incoming messages with improved logging
socket.on('new-message', (data) => {
    console.log('Received message:', data);
    const messagesDiv = ensureMessagesContainer();

    const messageDiv = document.createElement('div');
    messageDiv.className = data.isAI ? 'message ai-message' : 'message user-message';
    
    const messageHeader = document.createElement('div');
    messageHeader.className = 'message-header';
    
    const userName = document.createElement('strong');
    userName.textContent = data.userName || 'Unknown User';
    userName.style.color = data.isAI ? '#ff3366' : '#3399ff';
    
    const timestamp = document.createElement('span');
    timestamp.className = 'timestamp';
    timestamp.textContent = new Date().toLocaleTimeString([], { 
        hour: '2-digit', 
        minute: '2-digit',
        hour12: true 
    }).toUpperCase();
    
    messageHeader.appendChild(userName);
    messageHeader.appendChild(timestamp);
    
    const messageContent = document.createElement('div');
    messageContent.className = 'message-content';
    
    if (data.isAI && data.message.startsWith('Responding to')) {
        const messageParts = data.message.split('...');
        if (messageParts.length > 1) {
            const responseContext = document.createElement('div');
            responseContext.style.color = 'rgba(255, 255, 255, 0.5)';
            responseContext.style.marginBottom = '0.5rem';
            responseContext.textContent = messageParts[0] + '...';
            messageContent.appendChild(responseContext);
            messageContent.appendChild(document.createTextNode(messageParts[1].trim()));
        } else {
            messageContent.textContent = data.message;
        }
    } else {
        messageContent.textContent = data.message;
    }
    
    messageDiv.appendChild(messageHeader);
    messageDiv.appendChild(messageContent);
    
    messageDiv.dataset.messageId = data.messageId || Date.now().toString();
    messageDiv.dataset.deviceId = data.deviceId || deviceId;
    
    messagesDiv.appendChild(messageDiv);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
});

// Handle audio playback
socket.on('play-audio', (data) => {
    console.log('Received audio data:', data);
    if (!data.audioPath) {
        console.error('No audio path received');
        socket.emit('audio-complete');
        return;
    }

    // Ensure the audio path starts with a slash
    const audioPath = data.audioPath.startsWith('/') ? data.audioPath : '/' + data.audioPath;
    const fullAudioUrl = 'https://ask-kaia.onrender.com' + audioPath;
    console.log('Attempting to play audio from:', fullAudioUrl);

    const audio = new Audio(fullAudioUrl);
    
    audio.oncanplay = () => {
        console.log('Audio can play, starting playback');
        audio.play().catch(error => {
            console.error('Failed to play audio:', error);
            socket.emit('audio-complete');
        });
    };

    audio.onended = () => {
        console.log('Audio playback completed');
        socket.emit('audio-complete');
    };

    audio.onerror = (error) => {
        console.error('Audio playback error:', error);
        console.error('Audio error details:', {
            error: error,
            src: audio.src,
            networkState: audio.networkState,
            readyState: audio.readyState
        });
        socket.emit('audio-complete');
    };

    // Add a timeout in case audio fails to load
    setTimeout(() => {
        if (audio.paused) {
            console.error('Audio playback timeout - sending completion signal');
            console.error('Audio state at timeout:', {
                src: audio.src,
                networkState: audio.networkState,
                readyState: audio.readyState,
                error: audio.error
            });
            socket.emit('audio-complete');
        }
    }, 10000);
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