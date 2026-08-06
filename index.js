const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const qrcode = require('qrcode-terminal');
const express = require('express');
const pino = require('pino');
const fs = require('fs');

// Express Server (Keeps Render active)
const app = express();
const PORT = process.env.PORT || 8080;

app.get('/', (req, res) => {
    res.send('Quix WhatsApp Bot is active!');
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

// Helper function to load text files safely
function loadFile(filePath) {
    if (fs.existsSync(filePath)) {
        return fs.readFileSync(filePath, 'utf8');
    }
    return '';
}

// Load instructions and knowledge base
const instructions = loadFile('instructions.txt');
const knowledge = loadFile('knowledge.txt');

const fullSystemInstruction = [
    instructions,
    knowledge ? `\n\n--- KNOWLEDGE BASE ---\n${knowledge}` : ''
].join('').trim();

// Initialize Gemini AI
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({
    model: "gemini-2.5-flash",
    systemInstruction: fullSystemInstruction || "You are Quix, a brilliant, witty, and helpful AI assistant.",
    tools: [{ googleSearch: {} }]
});

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

    // Fetch the latest WhatsApp Web version to bypass 405 error
    const { version, isLatest } = await fetchLatestBaileysVersion();
    console.log(`Connecting with WhatsApp Web v${version.join('.')}`);

    const sock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        browser: ['Ubuntu', 'Chrome', '20.0.04'],
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 0,
        keepAliveIntervalMs: 10000
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;

        // Print clean QR code
        if (qr) {
            console.log('\n======================================');
            console.log('--- SCAN THIS QR CODE WITH WHATSAPP ---');
            console.log('======================================\n');
            qrcode.generate(qr, { small: true });
        }

        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

            console.log(`Connection closed (${statusCode || 'Unknown'}). Reconnecting in 5s...`);

            if (shouldReconnect) {
                setTimeout(startBot, 5000);
            }
        } else if (connection === 'open') {
            console.log('\n🚀 Quix is live on WhatsApp! 🚀\n');
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;

        for (const msg of messages) {
            if (msg.key.fromMe || msg.key.remoteJid === 'status@broadcast') continue;

            const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text;
            if (!text) continue;

            try {
                const result = await model.generateContent(text);
                const responseText = result.response.text();

                await sock.sendMessage(msg.key.remoteJid, { text: responseText }, { quoted: msg });
            } catch (error) {
                console.error('Error handling message:', error);
                await sock.sendMessage(msg.key.remoteJid, { text: "Having a little glitch processing that, try again in a sec!" }, { quoted: msg });
            }
        }
    });
}

startBot();