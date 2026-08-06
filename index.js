const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const qrcodeTerminal = require('qrcode-terminal');
const QRCode = require('qrcode');
const express = require('express');
const pino = require('pino');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 8080;

let latestQR = null;
let isConnected = false;

// Web page serving the live QR Code
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
                    <style>
                        body { background: #0f172a; color: #fff; font-family: sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
                        .card { background: #1e293b; padding: 2rem; border-radius: 1rem; text-align: center; box-shadow: 0 10px 25px rgba(0,0,0,0.5); }
                        img { border: 8px solid white; border-radius: 12px; margin-top: 1rem; width: 260px; height: 260px; }
                    </style>
                </head>
                <body>
                    <div class="card">
                        <h2>Scan QR Code with WhatsApp</h2>
                        <p>WhatsApp > Linked Devices > Link a Device</p>
                        <img src="${qrImage}" alt="WhatsApp QR Code" />
                    </div>
                </body>
                </html>
            `);
        } catch (err) {
            return res.send('Error generating QR image');
        }
    }

    res.send(`
        <div style="font-family: sans-serif; text-align: center; padding-top: 50px; background: #0f172a; color: #fff; min-height: 100vh;">
            <h2>Starting up... Refresh this page in 5 seconds!</h2>
        </div>
    `);
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
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

// Initialize Gemini AI
const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
    console.error("⚠️ WARNING: GEMINI_API_KEY is not set in environment variables!");
}

const genAI = new GoogleGenerativeAI(apiKey || "");
const model = genAI.getGenerativeModel({
    model: "gemini-3.1-flash-lite",
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
        browser: ['Ubuntu', 'Chrome', '20.0.04'],
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 0,
        keepAliveIntervalMs: 10000
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

            console.log(`Connection closed (${statusCode || 'Unknown'}). Reconnecting in 5s...`);

            if (shouldReconnect) {
                setTimeout(startBot, 5000);
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

startBot(); { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const qrcodeTerminal = require('qrcode-terminal');
const QRCode = require('qrcode');
const express = require('express');
const pino = require('pino');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 8080;

let latestQR = null;
let isConnected = false;

// Web page serving the live QR Code
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
                    <style>
                        body { background: #0f172a; color: #fff; font-family: sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
                        .card { background: #1e293b; padding: 2rem; border-radius: 1rem; text-align: center; box-shadow: 0 10px 25px rgba(0,0,0,0.5); }
                        img { border: 8px solid white; border-radius: 12px; margin-top: 1rem; width: 260px; height: 260px; }
                    </style>
                </head>
                <body>
                    <div class="card">
                        <h2>Scan QR Code with WhatsApp</h2>
                        <p>WhatsApp > Linked Devices > Link a Device</p>
                        <img src="${qrImage}" alt="WhatsApp QR Code" />
                    </div>
                </body>
                </html>
            `);
        } catch (err) {
            return res.send('Error generating QR image');
        }
    }

    res.send(`
        <div style="font-family: sans-serif; text-align: center; padding-top: 50px; background: #0f172a; color: #fff; min-height: 100vh;">
            <h2>Starting up... Refresh this page in 5 seconds!</h2>
        </div>
    `);
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
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

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({
    model: "gemini-2.5-flash",
    systemInstruction: fullSystemInstruction || "You are Quix, a brilliant, witty, and helpful AI assistant.",
    tools: [{ googleSearch: {} }]
});

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    const { version } = await fetchLatestBaileysVersion();

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

        if (qr) {
            latestQR = qr;
            console.log('\n--- NEW QR GENERATED! VISIT YOUR RENDER URL TO SCAN ---');
            qrcodeTerminal.generate(qr, { small: true });
        }

        if (connection === 'close') {
            isConnected = false;
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

            console.log(`Connection closed (${statusCode || 'Unknown'}). Reconnecting in 5s...`);

            if (shouldReconnect) {
                setTimeout(startBot, 5000);
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