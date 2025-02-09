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
    lastMessageTime: Date.now()
};

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

// Generate audio from text
async function generateAudio(text, userId) {
    try {
        console.log('Generating audio for text:', text);
        const request = {
            input: { text },
            voice: {
                languageCode: 'en-US',
                name: 'en-US-Studio-O',  // Using a different voice
                ssmlGender: 'FEMALE'
            },
            audioConfig: {
                audioEncoding: 'MP3',
                pitch: 0,
                speakingRate: 1.0,
                volumeGainDb: 3.0,  // Increased volume
                effectsProfileId: ['headphone-class-device']  // Changed profile for better audio
            },
        };

        console.log('Sending TTS request...');
        const [response] = await ttsClient.synthesizeSpeech(request);
        console.log('Received TTS response');

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
        console.error('Error generating audio:', error);
        throw error;  // Re-throw to handle in calling function
    }
}

// Generate Kaia's response
async function generateResponse(message, userName) {
    try {
        const prompt = `You are Kaia, a friendly AI assistant. Keep responses concise but engaging (2-3 sentences). Current user: ${userName}. Their message: "${message}"

        Guidelines:
        1. Always start with "Responding to [userName]'s message: [brief paraphrase of their message]..."
        2. Then provide your response
        3. Keep total response under 3 sentences
        4. Be friendly and engaging
        5. Make sure other listeners can follow the conversation

        Example formats:
        - "Responding to Alex's message about AI: Here's my perspective..."
        - "Responding to Sarah's question about coding: The key thing to understand is..."
        - "Responding to Mike's thoughts on technology: I find your perspective interesting..."`;

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

// Process messages from the queue
async function processMessageQueue() {
    if (state.isProcessing || state.waitingForAudioComplete || state.messageQueue.length === 0) {
        return;
    }

    state.isProcessing = true;
    try {
        const messageData = state.messageQueue.shift();
        console.log('Processing message:', messageData.message);

        const response = await generateResponse(messageData.message, messageData.userName);
        
        if (response) {
            console.log('Generated response:', response);

            try {
                // Send the text response immediately
                io.emit('new-message', {
                    message: response,
                    userId: 'kaia',
                    userName: 'Kaia',
                    isAI: true,
                    messageId: Date.now().toString(),
                    deviceId: 'kaia'
                });

                // Generate and send audio
                const audioResponse = await generateAudio(response, 'kaia');
                console.log('Generated audio response:', audioResponse);
                
                if (audioResponse) {
                    io.emit('play-audio', {
                        audioPath: audioResponse,
                        text: response
                    });
                    state.waitingForAudioComplete = true;
                } else {
                    console.error('No audio response generated');
                    state.waitingForAudioComplete = false;
                }
            } catch (error) {
                console.error('Error during audio generation or playback:', error);
                state.waitingForAudioComplete = false;
                io.emit('error', { message: 'Error processing audio response' });
            }
        } else {
            console.error('Failed to generate response');
            state.waitingForAudioComplete = false;
            io.emit('error', { message: 'Failed to generate response' });
        }
    } catch (error) {
        console.error('Error processing message queue:', error);
        state.waitingForAudioComplete = false;
        io.emit('error', { message: 'Error processing your message' });
    } finally {
        state.isProcessing = false;
        state.lastMessageTime = Date.now();
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

    socket.on('send-message', async (data) => {
        try {
            console.log('Received message from:', socket.id, 'Message:', data.message);
            
            // Only emit the user message from the server to prevent duplicates
            socket.broadcast.emit('new-message', {
                message: data.message,
                userId: data.userId,
                userName: data.userName,
                messageId: data.messageId,
                deviceId: data.deviceId,
                timestamp: Date.now()
            });
            
            // Generate Kaia's response
            const response = await generateResponse(data.message, data.userName);
            console.log('Generated response:', response);
            
            if (response) {
                // Send text response
                io.emit('new-message', {
                    message: response,
                    userId: 'kaia',
                    userName: 'Kaia',
                    isAI: true,
                    messageId: Date.now().toString(),
                    deviceId: 'kaia',
                    timestamp: Date.now()
                });

                try {
                    // Generate and send audio
                    const audioResponse = await generateAudio(response, 'kaia');
                    console.log('Generated audio response:', audioResponse);
                    
                    if (audioResponse) {
                        io.emit('play-audio', {
                            audioPath: audioResponse,
                            text: response
                        });
                    } else {
                        console.error('No audio response generated');
                    }
                } catch (error) {
                    console.error('Error during audio generation:', error);
                    socket.emit('error', { message: 'Error generating audio response' });
                }
            } else {
                console.error('Failed to generate response');
                socket.emit('error', { message: 'Failed to generate response' });
            }
        } catch (error) {
            console.error('Error handling message:', error);
            socket.emit('error', { message: 'Error processing your message' });
        }
    });

    socket.on('audio-complete', () => {
        console.log('Received audio completion signal from:', socket.id);
    });

    socket.on('disconnect', (reason) => {
        console.log('Client disconnected:', socket.id, 'Reason:', reason);
        state.activeListeners.delete(socket.id);
        io.emit('listener-count', state.activeListeners.size);
    });
});

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