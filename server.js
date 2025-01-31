const express = require('express');
const OpenAI = require('openai');
const cors = require('cors');
const http = require('http');
const socketIo = require('socket.io');
const textToSpeech = require('@google-cloud/text-to-speech');
const fs = require('fs').promises;
const path = require('path');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST']
    }
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

app.use(cors({
    origin: '*',
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type']
}));
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

// Global state
const state = {
    activeListeners: new Set(),
    messageQueue: [],
    currentTopic: null,
    isProcessing: false,
    conversationHistory: [],
    lastMessageTime: null,
    waitingForAudioComplete: false
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
        const context = state.conversationHistory.slice(-3).map(msg => 
            msg.type === 'user' ? `User: ${msg.text}` : `Kaia: ${msg.text}`
        ).join('\n');

        const prompt = `You are Kaia, an engaging AI host. ${userName} has sent this message: "${message}"

        Recent conversation:
        ${context}
        
        Create a natural, conversational response that:
        1. ALWAYS starts by mentioning both ${userName}'s name and their exact message
        2. Shows genuine interest and engagement
        3. Uses a warm and friendly tone
        4. Provides thoughtful insights
        5. Encourages further discussion
        
        Your response MUST begin with one of these formats (using the exact name and message):
        - "Responding to ${userName}'s message about '${message}'..."
        - "${userName} asks '${message}' - let me address that..."
        - "Interesting question from ${userName} asking '${message}'..."
        
        Keep the response concise (2-3 sentences) and natural, as it will be spoken aloud.`;

        const completion = await openai.chat.completions.create({
            model: "gpt-3.5-turbo",
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
    if (state.isProcessing || state.messageQueue.length === 0 || state.waitingForAudioComplete) {
        console.log('Queue processing skipped - ' + 
            (state.isProcessing ? 'already processing' : 
             state.waitingForAudioComplete ? 'waiting for audio to complete' : 
             'empty queue'));
        return;
    }
    
    try {
        state.isProcessing = true;
        state.waitingForAudioComplete = true;
        console.log('Starting to process message queue. Current queue length:', state.messageQueue.length);
        
        // Sort messages by score in descending order
        state.messageQueue.sort((a, b) => b.score - a.score);
        
        // Get the highest scored message
        const topMessage = state.messageQueue.shift();
        console.log('Processing message:', topMessage.message);
        
        // Generate and broadcast response
        const response = await generateResponse(topMessage.message, topMessage.userName);
        if (!response) {
            throw new Error('Failed to generate response');
        }

        console.log('Generated response:', response);
        
        try {
            const audioUrl = await generateAudio(response, topMessage.userId);
            console.log('Generated audio URL:', audioUrl);
            
            if (!audioUrl) {
                throw new Error('Failed to generate audio URL');
            }
            
            // Broadcast the response to all connected clients
            io.emit('new_response', {
                type: 'response',
                text: response,
                audioUrl: audioUrl,
                userId: topMessage.userId,
                userName: topMessage.userName,
                originalMessage: topMessage.message,
                timestamp: Date.now()
            });
            
            // Update conversation history
            state.conversationHistory.push(
                {
                    type: 'user',
                    text: topMessage.message,
                    userId: topMessage.userId,
                    timestamp: Date.now()
                },
                {
                    type: 'assistant',
                    text: response,
                    timestamp: Date.now()
                }
            );

            // Trim conversation history if too long
            if (state.conversationHistory.length > 10) {
                state.conversationHistory = state.conversationHistory.slice(-10);
            }
            
        } catch (error) {
            console.error('Error in audio generation:', error);
            io.emit('error', {
                status: 'error',
                message: 'Failed to generate audio response'
            });
        }
    } catch (error) {
        console.error('Error in message queue processing:', error);
        io.emit('error', {
            status: 'error',
            message: 'Failed to process message queue'
        });
    } finally {
        state.isProcessing = false;
        state.waitingForAudioComplete = false;
        
        // Process next message if queue not empty
        if (state.messageQueue.length > 0) {
            setTimeout(processMessageQueue, 1000);
        }
    }
}

// Socket connection handling
io.on('connection', (socket) => {
    console.log('New client connected:', socket.id);
    state.activeListeners.add(socket.id);
    io.emit('listener_count', state.activeListeners.size);

    socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);
        state.activeListeners.delete(socket.id);
        io.emit('listener_count', state.activeListeners.size);
    });

    socket.on('chat_message', async (data) => {
        console.log('Received message:', data);
        try {
            const { message, userId, userName } = data;
            if (!message || !userId || !userName) {
                console.error('Invalid message data:', data);
                return;
            }

            const score = scoreMessage(message, userId);
            state.messageQueue.push({
                message,
                userId,
                userName,
                score,
                timestamp: Date.now()
            });

            // Emit message received confirmation
            socket.emit('message_received', {
                status: 'success',
                message: 'Message added to queue'
            });

            // Start processing queue if not already processing
            if (!state.isProcessing && !state.waitingForAudioComplete) {
                processMessageQueue();
            }
        } catch (error) {
            console.error('Error processing chat message:', error);
            socket.emit('error', {
                status: 'error',
                message: 'Failed to process message'
            });
        }
    });
});

// Start processing loop with longer interval
setInterval(() => {
    if (!state.isProcessing && !state.waitingForAudioComplete && state.messageQueue.length > 0) {
        processMessageQueue();
    }
}, 5000); // Increased to 5 seconds

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
});

// Start the server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    console.log('OpenAI API Key:', process.env.OPENAI_API_KEY ? 'Present' : 'Missing');
    console.log('Google Credentials:', process.env.GOOGLE_APPLICATION_CREDENTIALS ? 'Present' : 'Missing');
}); 