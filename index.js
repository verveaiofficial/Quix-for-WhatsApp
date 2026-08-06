const baileys = require('@whiskeysockets/baileys');
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

// Supabase Cloud Storage Details
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://jjxdsfacsotgibzcgvrn.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'sb_publishable_2tXd0mJuMskR9zsrGvMSYw_IwWaEKsl';

const BufferJSON = baileys.BufferJSON || {
    replacer: (k, value) => {
        if (Buffer.isBuffer(value) || value instanceof Uint8Array || value?.type === 'Buffer') {
            return { type: 'Buffer', data: Buffer.from(value?.data || value).toString('base64') };
        }
        return value;
    },
    reviver: (k, value) => {
        if (typeof value === 'object' && value !== null && (value.buffer === true || value.type === 'Buffer')) {
            const val = value.data || value.value;
            return typeof val === 'string' ? Buffer.from(val, 'base64') : Buffer.from(val || []);
        }
        return value;
    }
};

async function useSupabaseAuthState() {
    const logger = pino({ level: 'silent' });

    const fetchSupabase = async (endpoint, options = {}) => {
        const url = `${SUPABASE_URL}/rest/v1/${endpoint}`;
        const defaultHeaders = {
            'apikey': SUPABASE_KEY,
            'Authorization': `Bearer ${SUPABASE_KEY}`,
            'Content-Type': 'application/json'
        };
        options.headers = { ...defaultHeaders, ...(options.headers || {}) };
        return await fetch(url, options);
    };

    const readData = async (id) => {
        try {
            const res = await fetchSupabase(`wa_auth?id=eq.${encodeURIComponent(id)}&select=data`);
            if (!res.ok) return null;
            const rows = await res.json();
            if (Array.isArray(rows) && rows.length > 0 && rows[0].data) {
                return JSON.parse(JSON.stringify(rows[0].data), BufferJSON.reviver);
            }
            return null;
        } catch (e) {
            console.error('Supabase read error:', e.message || e);
            return null;
        }
    };

    const writeData = async (id, data) => {
        try {
            await fetchSupabase('wa_auth', {
                method: 'POST',
                headers: { 'Prefer': 'resolution=merge-duplicates' },
                body: JSON.stringify({
                    id,
                    data: JSON.parse(JSON.stringify(data, BufferJSON.replacer))
                })
            });
        } catch (e) {
            console.error('Supabase write error:', e.message || e);
        }
    };

    const removeData = async (id) => {
        try {
            await fetchSupabase(`wa_auth?id=eq.${encodeURIComponent(id)}`, {
                method: 'DELETE'
            });
        } catch (e) {
            console.error('Supabase delete error:', e.message || e);
        }
    };

    const clearAllData = async () => {
        try {
            await fetchSupabase('wa_auth?id=neq.none', {
                method: 'DELETE'
            });
        } catch (e) {
            console.error('Supabase clear error:', e.message || e);
        }
    };

    const creds = (await readData('creds')) || (baileys.initAuthCreds ? baileys.initAuthCreds() : {});

    const keys = {
        get: async (type, ids) => {
            const data = {};
            await Promise.all(
                ids.map(async (id) => {
                    let value = await readData(`${type}-${id}`);
                    if (value && type === 'app-state-sync-key' && baileys.proto) {
                        value = baileys.proto.Message.AppStateSyncKeyData.fromObject(value);
                    }
                    data[id] = value;
                })
            );
            return data;
        },
        set: async (data) => {
            const tasks = [];
            for (const category in data) {
                for (const id in data[category]) {
                    const value = data[category][id];
                    const key = `${category}-${id}`;
                    if (value) {
                        tasks.push(writeData(key, value));
                    } else {
                        tasks.push(removeData(key));
                    }
                }
            }
            await Promise.all(tasks);
        }
    };

    return {
        state: {
            creds,
            keys: baileys.makeCacheableSignalKeyStore ? baileys.makeCacheableSignalKeyStore(keys, logger) : keys
        },
        saveCreds: async () => {
            await writeData('creds', creds);
        },
        clearSession: async () => {
            await clearAllData();
        }
    };
}

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
                    <meta http-equiv="refresh" content="15">
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
                        <p style="margin-top: 15px;">Refreshing code every 15 seconds...</p>
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
            fetch(renderUrl).catch(() => {});
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
    model: "gemini-3.5-flash-lite",
    systemInstruction: fullSystemInstruction || "You are Quix, a brilliant, witty, and helpful AI assistant."
});

async function startBot() {
    const { state, saveCreds, clearSession } = await useSupabaseAuthState();
    const { version } = await baileys.fetchLatestBaileysVersion();

    const sock = baileys.default({
        version,
        auth: state,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        browser: ['Chrome (Linux)', 'Chrome', '120.0.0.0'],
        connectTimeoutMs: 60000,
        keepAliveIntervalMs: 10000,
        emitOwnEvents: false,
        markOnlineOnConnect: true
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            latestQR = qr;
            isConnected = false;
            console.log('\n--- NEW QR GENERATED! VISIT YOUR RENDER URL TO SCAN ---');
            qrcodeTerminal.generate(qr, { small: true });
        }

        if (connection === 'close') {
            isConnected = false;
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            const shouldReconnect = statusCode !== baileys.DisconnectReason.loggedOut;

            console.log(`Connection closed (${statusCode || 'Unknown'}). Reconnecting...`);

            if (statusCode === baileys.DisconnectReason.loggedOut) {
                console.log('Device logged out. Clearing Supabase session...');
                await clearSession();
            }

            if (shouldReconnect) {
                setTimeout(startBot, 3000);
            } else {
                setTimeout(startBot, 5000);
            }
        } else if (connection === 'open') {
            isConnected = true;
            latestQR = null;
            console.log('\n🚀 Quix is live on WhatsApp (Backed by Supabase)! 🚀\n');
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

                if (responseText) {
                    await sock.sendMessage(msg.key.remoteJid, { text: responseText }, { quoted: msg });
                } else {
                    await sock.sendMessage(msg.key.remoteJid, { text: "Hmm, got an empty thought back. Try again!" }, { quoted: msg });
                }
            } catch (error) {
                console.error('❌ GEMINI API ERROR DETAILS:', error.message || error);
                await sock.sendMessage(msg.key.remoteJid, { text: `Error: ${error.message || "Failed to process"}` }, { quoted: msg });
            }
        }
    });
}

startBot();
