const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const qrcode = require('qrcode-terminal');
const express = require('express');

// Express Server (Keeps Render alive)
const app = express();
const PORT = process.env.PORT || 8080;

app.get('/', (req, res) => {
    res.send('Quix WhatsApp Bot is active!');
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

// Initialize Gemini AI
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({
    model: "gemini-2.5-flash",
    tools: [{ googleSearch: {} }]
});

async function startBot() {
    // Saves session data so you don't have to scan every restart
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: true
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;

        // Displays QR code in your server logs
        if (qr) {
            console.log('\n--- SCAN THIS QR CODE WITH WHATSAPP ---\n');
            qrcode.generate(qr, { small: true });
        }

        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut);
            console.log('Connection closed. Reconnecting...', shouldReconnect);
            if (shouldReconnect) {
                startBot();
            }
        } else if (connection === 'open') {
            console.log('Quix is live on WhatsApp! 🚀✨');
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;

        for (const msg of messages) {
            // Ignore bot's own messages and status updates
            if (msg.key.fromMe || msg.key.remoteJid === 'status@broadcast') continue;

            const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text;
            if (!text) continue;

            try {
                // Get answer from Gemini
                const result = await model.generateContent(text);
                const responseText = result.response.text();

                // Send reply back to user
                await sock.sendMessage(msg.key.remoteJid, { text: responseText }, { quoted: msg });
            } catch (error) {
                console.error('Error handling message:', error);
                await sock.sendMessage(msg.key.remoteJid, { text: "Having a little glitch processing that, try again in a sec!" }, { quoted: msg });
            }
        }
    });
}

startBot();
