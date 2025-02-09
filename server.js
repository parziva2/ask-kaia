const express = require('express');
const OpenAI = require('openai');
const cors = require('cors');
const http = require('http');
const socketIo = require('socket.io');
const textToSpeech = require('@google-cloud/text-to-speech');
const fs = require('fs').promises;
const path = require('path');
const multer = require('multer');
require('dotenv').config();

const app = express();
const server = http.createServer(app);

const corsOptions = {
    origin: ['https://askkaia.com', 'http://localhost:3000'],
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-requested-with'],
    credentials: true,
    preflightContinue: false,
    optionsSuccessStatus: 204
};

// Enable CORS for all routes with specific options
app.use(cors(corsOptions));

// Handle preflight requests explicitly
app.options('*', cors(corsOptions));

// Configure Socket.IO with matching CORS settings
const io = socketIo(server, {
    cors: {
        origin: ['https://askkaia.com', 'http://localhost:3000'],
        methods: ['GET', 'POST'],
        allowedHeaders: ['Content-Type', 'Authorization', 'x-requested-with'],
        credentials: true
    },
    transports: ['polling', 'websocket'],
    allowEIO3: true,
    pingTimeout: 60000,
    pingInterval: 25000,
    path: '/socket.io'
});

// Configure OpenAI with custom settings
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: 'https://api.openai.com/v1'
});

// Initialize Text-to-Speech client
const ttsClient = new textToSpeech.TextToSpeechClient({
    keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS
});

app.use(express.json());

// Create public directory if it doesn't exist
const publicDir = path.join(__dirname, 'public');
const audioDir = path.join(publicDir, 'audio');

async function ensureDirectories() {
    try {
        await fs.mkdir(publicDir, { recursive: true });
        await fs.mkdir(audioDir, { recursive: true });
        console.log('Directories created successfully');
        console.log('Audio directory path:', audioDir);
    } catch (error) {
        console.error('Error creating directories:', error);
    }
}

// Call this immediately
ensureDirectories();

// Serve static files from public directory
app.use(express.static(publicDir));
app.use('/audio', express.static(audioDir));

// State management for message processing
const state = {
    messageQueue: [],
    isProcessing: false,
    waitingForAudioComplete: false,
    activeListeners: new Set(),
    lastMessageTime: Date.now(),
    conversationHistory: [],
    competedMessages: new Set(),
    winningMessages: new Set(),
    currentCompetition: {
        messages: [],
        startTime: null,
        endTime: null,
        isActive: false,
        winningMessage: null
    }
};

// Competition settings
const COMPETITION_DURATION = 30000; // 30 seconds
const MIN_MESSAGES_TO_START = 3;
const MAX_MESSAGES_PER_COMPETITION = 10;

// Score messages for interest and relevance
function scoreMessage(message, userId) {
    let score = 0;
    
    // Length bonus (encourages detailed messages)
    score += Math.min(message.length / 20, 5);
    
    // Question bonus (higher priority)
    if (message.includes('?')) score += 5;
    
    // Personal sharing bonus
    if (message.toLowerCase().includes('i ') || message.toLowerCase().includes('my ')) score += 3;
    
    // Interesting keywords bonus (increased weights)
    const interestingWords = {
        high: ['why', 'how', 'what if', 'imagine', 'could', 'should', 'would'],
        medium: ['think', 'feel', 'believe', 'interesting', 'amazing', 'curious'],
        low: ['wonder', 'possible', 'future', 'idea', 'theory', 'experience']
    };
    
    interestingWords.high.forEach(word => {
        if (message.toLowerCase().includes(word)) score += 3;
    });
    
    interestingWords.medium.forEach(word => {
        if (message.toLowerCase().includes(word)) score += 2;
    });
    
    interestingWords.low.forEach(word => {
        if (message.toLowerCase().includes(word)) score += 1;
    });
    
    // Recent participation penalty (prevents monopolization)
    const recentMessages = state.conversationHistory.filter(msg => msg.userId === userId);
    if (recentMessages.length > 0) {
        const timeSinceLastMessage = Date.now() - recentMessages[recentMessages.length - 1].timestamp;
        score -= Math.max(0, 8 - (timeSinceLastMessage / 1000 / 60)); // Increased penalty, decreases over 8 minutes
    }
    
    // Queue position penalty (older messages get priority if scores are close)
    const queuePosition = state.messageQueue.length;
    score += Math.max(0, 3 - (queuePosition * 0.5)); // Bonus for being earlier in the queue
    
    return score;
}

// Generate audio from text with improved error handling
async function generateAudio(text, userId) {
    try {
        console.log('Generating audio for text:', text);
        const request = {
            input: { text },
            voice: {
                languageCode: 'en-US',
                name: 'en-US-Studio-O',
                ssmlGender: 'FEMALE'
            },
            audioConfig: {
                audioEncoding: 'MP3',
                pitch: 0,
                speakingRate: 1.0,
                volumeGainDb: 3.0,
                effectsProfileId: ['headphone-class-device']
            },
        };

        console.log('Sending TTS request...');
        const [response] = await ttsClient.synthesizeSpeech(request);
        
        if (!response || !response.audioContent) {
            console.error('No audio content in response');
            throw new Error('No audio content received from TTS service');
        }

        const audioFileName = `response-${Date.now()}-${userId}.mp3`;
        const audioPath = path.join(audioDir, audioFileName);
        
        await fs.writeFile(audioPath, response.audioContent, 'binary');
        console.log(`Audio file created at: ${audioPath}`);
        
        const stats = await fs.stat(audioPath);
        if (stats.size === 0) {
            console.error('Generated audio file is empty');
            throw new Error('Generated audio file is empty');
        }
        
        const audioUrl = `/audio/${audioFileName}`;
        console.log(`Audio URL: ${audioUrl}`);
        
        return audioUrl;
    } catch (error) {
        console.error('Error in generateAudio:', error);
        throw error;
    }
}

// Generate Kaia's response
async function generateResponse(message, userName, isCompetitionWinner = false) {
    try {
        const prompt = isCompetitionWinner ?
            `You are Kaia, hosting a live AI talk show. This message won the competition for being most interesting! Current user: ${userName}. Their winning message: "${message}"

            Guidelines:
            1. Start with an enthusiastic announcement that this message won
            2. Briefly explain why it's an interesting message
            3. Provide your thoughtful response
            4. Keep total response under 4 sentences
            5. Be engaging and dynamic, like a live show host

            Example format:
            "Congratulations! We have a winning message from [userName]! This caught my attention because... Here's my response..."` :
            `You are Kaia, a friendly AI assistant. Keep responses concise but engaging (2-3 sentences). Current user: ${userName}. Their message: "${message}"

            Guidelines:
            1. Always start with "Responding to [userName]'s message..."
            2. Then provide your response
            3. Keep total response under 3 sentences
            4. Be friendly and engaging`;

        const completion = await openai.chat.completions.create({
            model: "gpt-4-0125-preview",
            messages: [{ role: "system", content: prompt }],
            max_tokens: 150,
            temperature: 0.7,
            presence_penalty: 0.6
        });

        return completion.choices[0].message.content;
    } catch (error) {
        console.error('Error generating response:', error);
        return null;
    }
}

// Socket connection handling with improved reliability
io.on('connection', (socket) => {
    console.log('New client connected:', socket.id);
    
    // Send current state to new client
    socket.emit('connection-state', {
        activeListeners: state.activeListeners.size,
        serverTime: Date.now()
    });
    
    state.activeListeners.add(socket.id);
    io.emit('listener-count', state.activeListeners.size);

    // Send current competition state
    socket.emit('competition-state', {
        isActive: state.currentCompetition.isActive,
        endTime: state.currentCompetition.endTime,
        messageCount: state.currentCompetition.messages.length
    });

    socket.on('send-message', async (data) => {
        try {
            console.log('Received message:', data);
            
            if (!state.currentCompetition.isActive) {
                // Start a new competition if none is active
                startCompetitionRound();
                socket.emit('message-error', { message: 'Starting new competition round...' });
                
                // Wait for the competition to start before processing the message
                setTimeout(() => {
                    processNewMessage(data, socket);
                }, 1000);
                return;
            }
            
            processNewMessage(data, socket);
            
        } catch (error) {
            console.error('Error handling message:', error);
            socket.emit('error', { message: 'Error processing your message' });
        }
    });

    socket.on('audio-complete', () => {
        console.log('Received audio completion signal from:', socket.id);
        // Broadcast audio completion to all clients
        io.emit('audio-playback-complete', { timestamp: Date.now() });
    });

    socket.on('disconnect', (reason) => {
        console.log('Client disconnected:', socket.id, 'Reason:', reason);
        state.activeListeners.delete(socket.id);
        io.emit('listener-count', state.activeListeners.size);
    });
});

// Add new function to process messages with improved broadcasting
async function processNewMessage(data, socket) {
    // Check if message has already competed
    if (state.competedMessages.has(data.message)) {
        socket.emit('message-error', { message: 'This message has already competed in a round.' });
        return;
    }

    if (state.currentCompetition.messages.length >= MAX_MESSAGES_PER_COMPETITION) {
        socket.emit('message-error', { message: 'This round is full. Please wait for the next round.' });
        return;
    }
    
    const score = scoreMessage(data.message, data.userId);
    const messageData = {
        ...data,
        score,
        timestamp: Date.now(),
        isCompeting: true
    };
    
    // Add to competition messages
    state.currentCompetition.messages.push(messageData);
    
    // Add to competed messages set
    state.competedMessages.add(data.message);
    
    // Broadcast the message to all clients
    console.log('Broadcasting message to all clients:', messageData);
    io.emit('new-message', messageData);
    
    // Start competition if minimum messages reached
    if (state.currentCompetition.messages.length >= MIN_MESSAGES_TO_START && !state.currentCompetition.isActive) {
        startCompetitionRound();
    }
}

// Start a new competition round
function startCompetitionRound() {
    if (state.currentCompetition.isActive) return;
    
    console.log('Starting new competition round');
    state.currentCompetition = {
        messages: state.currentCompetition.messages || [], // Keep existing messages
        startTime: Date.now(),
        endTime: Date.now() + COMPETITION_DURATION,
        isActive: true,
        winningMessage: null
    };
    
    io.emit('competition-start', {
        duration: COMPETITION_DURATION,
        endTime: state.currentCompetition.endTime
    });
    
    // Schedule competition end
    setTimeout(endCompetitionRound, COMPETITION_DURATION);
}

// End current competition round with improved broadcasting
async function endCompetitionRound() {
    if (!state.currentCompetition.isActive) return;
    
    const messages = state.currentCompetition.messages.filter(msg => !state.winningMessages.has(msg.message));
    if (messages.length === 0) {
        state.currentCompetition.isActive = false;
        startCompetitionRound(); // Start new round if no messages
        return;
    }
    
    // Select winning message
    const winningMessage = messages.reduce((prev, current) => 
        (prev.score > current.score) ? prev : current
    );
    
    state.currentCompetition.winningMessage = winningMessage;
    state.currentCompetition.isActive = false;
    state.winningMessages.add(winningMessage.message);
    
    // Clean up old winning messages (keep only last hour)
    const oneHourAgo = Date.now() - (60 * 60 * 1000);
    state.conversationHistory = state.conversationHistory.filter(msg => msg.timestamp > oneHourAgo);
    state.winningMessages.clear();
    
    try {
        // Generate text response
        const response = await generateResponse(winningMessage.message, winningMessage.userName, true);
        
        if (response) {
            console.log('Generated text response:', response);
            
            // Generate audio response
            let audioUrl = null;
            try {
                console.log('Generating audio for response...');
                audioUrl = await generateAudio(response, winningMessage.userId);
                console.log('Generated audio URL:', audioUrl);
                
                // Broadcast winner with audio URL to all clients
                const winnerData = {
                    userName: winningMessage.userName,
                    message: winningMessage.message,
                    response: response,
                    score: winningMessage.score,
                    audioUrl: audioUrl,
                    timestamp: Date.now()
                };
                
                console.log('Broadcasting winner to all clients:', winnerData);
                io.emit('competition-winner', winnerData);
                
                // Explicitly send audio play command to all clients
                io.emit('play-audio', {
                    audioPath: audioUrl,
                    text: response
                });
                
                // Add to conversation history
                state.conversationHistory.push({
                    ...winningMessage,
                    response,
                    audioUrl,
                    timestamp: Date.now()
                });
            } catch (error) {
                console.error('Error generating audio:', error);
                // Still emit the winner even if audio fails
                io.emit('competition-winner', {
                    userName: winningMessage.userName,
                    message: winningMessage.message,
                    response: response,
                    score: winningMessage.score,
                    timestamp: Date.now()
                });
            }
        }
    } catch (error) {
        console.error('Error handling winning message:', error);
    }
    
    // Start new round after a short delay
    setTimeout(startCompetitionRound, 5000);
}

// Start processing loop with shorter interval
setInterval(() => {
    if (!state.isProcessing && !state.waitingForAudioComplete && state.messageQueue.length > 0) {
        processMessageQueue();
    }
}, 3000); // Reduced to 3 seconds

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
}); 