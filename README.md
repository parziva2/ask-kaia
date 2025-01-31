# Ask Kaia - Live AI Talk Show

A live AI talk show where Kaia picks the most engaging messages to answer in front of thousands of listeners. Messages compete to be featured, and Kaia responds with both text and voice in real-time.

## Features

- Live message prioritization system
- Real-time text-to-speech responses
- Dynamic listener count
- Interactive chat interface
- Message scoring and queuing system

## Environment Variables

The following environment variables are required:

```env
OPENAI_API_KEY=your_openai_api_key
GOOGLE_APPLICATION_CREDENTIALS=./google-credentials.json
PORT=3000
```

## Deployment on Render

1. Create a new Web Service on Render
2. Connect your GitHub repository
3. Use the following settings:
   - Environment: Node
   - Build Command: `npm install`
   - Start Command: `npm start`
4. Add your environment variables in the Render dashboard
5. Add your Google Cloud credentials as a secret file

## Development

1. Clone the repository
2. Install dependencies: `npm install`
3. Create a `.env` file with required variables
4. Add your Google Cloud credentials file
5. Run the development server: `npm run dev` 