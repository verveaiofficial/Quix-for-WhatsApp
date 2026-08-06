const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const qrcodeTerminal = require('qrcode-terminal');
const QRCode = require('qrcode');
const express = require('express');
const pino = require('pino');
const fs = require('fs');
const http = require('http');

const app = express();
const PORT = process.env.PORT || 8080;

let latestQR = null;
let isConnected = false;

app.get('/', async (req, res) => {
    if (isConnected) {
        return res.send(`
            <div style="font-family: sans-serif; text-align: center; padding-top: 50px; background: #0f172a; color: #fff; min-height: 100vh;">
                <h1 style="color: #4ade80;">🚀 Quix WhatsApp Bot is Active & Connected!</h1>
            </div>
        `);
    }

    if (latestQR) {
        try {
            const qrImage = await QRCode.toDataURL(latestQR);
            return res.send(`
                <!DOCTYPE html>
                <html>
                <head>
                    <title>Quix WhatsApp Setup</title>
                    <meta name="viewport" content="width=device-width, initial-scale=1.0">
                    <meta http-equiv="refresh" content="10">
                    <style>
                        body { background: #0f172a; color: #fff; font-family: sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
                        .card { background: #1e293b; padding: 2rem; border-radius: 1rem; text-align: center; box-shadow: 0 10px 25px rgba(0,0,0,0.5); }
                        img { border: 8px solid white; border-radius: 12px; margin-top: 1rem; width: 260px; height: 260px; }
                        p { color: #94a3b8; font-size: 0.9rem; }
                    </style>
                </head>
                <body>
                    <div class="card">
                        <h2>Scan QR Code with WhatsApp</h2>
                        <p>WhatsApp > Linked Devices > Link a Device</p>
                        <img src="${qrImage}" alt="WhatsApp QR Code" />
                        <p style="margin-top: 15px;">Refreshing code every 10 seconds...</p>
                    </div>
                </body>
                </html>
            `);
        } catch (err) {
            return res.send('Error generating QR image');
        }
    }

    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <meta http-equiv="refresh" content="3">
            <style>
                body { background: #0f172a; color: #fff; font-family: sans-serif; text-align: center; padding-top: 100px; margin: 0; }
            </style>
        </head>
        <body>
            <h2>Starting up... Generating QR code, please wait!</h2>
        </body>
        </html>
    `);
});

const server = app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    
    setInterval(() => {
        const renderUrl = process.env.RENDER_EXTERNAL_URL;
        if (renderUrl) {
            http.get(renderUrl, (res) => {}).on('error', (err) => {});
        }
    }, 300000);
});

function loadFile(filePath) {
    if (fs.existsSync(filePath)) {
        return fs.readFileSync(filePath, 'utf8');
    }
    return '';
}

const instructions = loadFile('instructions.txt');
const knowledge = loadFile('knowledge.txt');

const fullSystemInstruction = [
    instructions,
    knowledge ? `\n\n--- KNOWLEDGE BASE ---\n${knowledge}` : ''
].join('').trim();

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
    console.error("⚠️ WARNING: GEMINI_API_KEY is not set in environment variables!");
}

const genAI = new GoogleGenerativeAI(apiKey || "");
const model = genAI.getGenerativeModel({
    model: "gemini-2.5-flash",
    systemInstruction: fullSystemInstruction || "You are Quix, a brilliant, witty, and helpful AI assistant."
});

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        browser: ['Chrome (Linux)', 'Chrome', '120.0.0.0'],
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 0,
        keepAliveIntervalMs: 15000
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            latestQR = qr;
            console.log('\n--- NEW QR GENERATED! VISIT YOUR RENDER URL TO SCAN ---');
            qrcodeTerminal.generate(qr, { small: true });
        }

        if (connection === 'close') {
            isConnected = false;
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

            console.log(`Connection closed (${statusCode || 'Unknown'}). Reconnecting...`);

            if (shouldReconnect) {
                setTimeout(startBot, 3000);
            }
        } else if (connection === 'open') {
            isConnected = true;
            latestQR = null;
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
                const chatSession = model.startChat({ history: [] });
                const result = await chatSession.sendMessage(text);
                const responseText = result.response.text();

                await sock.sendMessage(msg.key.remoteJid, { text: responseText }, { quoted: msg });
            } catch (error) {
                console.error('❌ GEMINI API ERROR DETAILS:', error);
                await sock.sendMessage(msg.key.remoteJid, { text: "Having a little glitch processing that, try again in a sec!" }, { quoted: msg });
            }
        }
    });
}

startBot();