// ============================================
//   🚀 server.js — AI Email Agent UI Server
//   - Web API for fetching incoming emails & drafts
//   - Background auto-drafter with Gemini
//   - Send, edit, re-generate actions
// ============================================

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const { ImapFlow } = require("imapflow");
const { generateReply } = require("./ai");
const { sendReply, saveDraft, markAsRead } = require("./gmail");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const USER      = process.env.GMAIL_USER;
const PASSWORD  = process.env.GMAIL_APP_PASSWORD;
const YOUR_NAME = process.env.YOUR_NAME || "Ahmed";
const YOUR_ROLE = process.env.YOUR_ROLE || "Oracle APEX Technical Consultant";

// In-memory store for UI items: { uid, from, subject, messageId, date, body, aiDraft, status: 'drafted'|'sent' }
const emailStore = new Map();
const processedUids = new Set();

function createClient() {
  return new ImapFlow({
    host: "imap.gmail.com",
    port: 993,
    secure: true,
    auth: { user: USER, pass: PASSWORD },
    logger: false,
    emitLogs: false,
    clientInfo: { name: "email-agent-ui", version: "1.0.0" }
  });
}

function extractText(raw) {
  const match = raw.match(/Content-Type: text\/plain[\s\S]*?\r?\n\r?\n([\s\S]*?)(\r?\n--|\s*$)/i);
  if (match) return match[1].trim();
  const bodyStart = raw.indexOf("\r\n\r\n");
  if (bodyStart !== -1) return raw.slice(bodyStart + 4).trim();
  return raw.trim();
}

// Background auto-processor
async function processEmail(client, uid) {
  try {
    const messages = [];
    for await (const msg of client.fetch([uid], { envelope: true, source: true })) {
      messages.push(msg);
    }
    if (messages.length === 0) return;
    const msg = messages[0];

    const from      = msg.envelope.from?.[0]?.address || "";
    const subject   = msg.envelope.subject || "(No Subject)";
    const messageId = msg.envelope.messageId || "";
    const date      = msg.envelope.date || new Date();
    const body      = extractText(msg.source.toString()).slice(0, 2000);

    if (from.toLowerCase() === USER.toLowerCase()) return;

    console.log(`\n📨 UI Agent: New Email from ${from} | ${subject}`);
    const draftText = await generateReply({
      from,
      subject,
      body,
      yourName: YOUR_NAME,
      yourRole: YOUR_ROLE
    });

    const emailRecord = {
      uid,
      from,
      subject,
      messageId,
      date: new Date(date).toLocaleString(),
      body,
      aiDraft: draftText,
      status: "drafted"
    };

    emailStore.set(uid, emailRecord);

    // Also persist to Gmail Drafts
    await saveDraft({ to: from, subject, messageId, body: draftText });
    console.log(`   📝 AI Draft prepared & stored for UID ${uid}`);
  } catch (err) {
    console.error(`Error processing email ${uid}:`, err.message);
  }
}

// Continuous background checker
async function startBackgroundWorker() {
  // Initial index of latest 10 messages for immediate display in UI
  try {
    const client = createClient();
    await client.connect();
    await client.mailboxOpen("INBOX");
    const all = await client.search({ all: true });
    
    // Process the last 5 messages so the UI has immediately visible conversations
    const latestItems = all.slice(-5);
    all.forEach(id => processedUids.add(id));

    console.log(`🤖 Loading latest ${latestItems.length} messages for UI display...`);
    for (const uid of latestItems) {
      await processEmail(client, uid);
    }
    await client.logout();
  } catch (e) {
    console.error("Init worker error:", e.message);
  }

  // Active check loop
  while (true) {
    let client = null;
    try {
      client = createClient();
      await client.connect();
      await client.mailboxOpen("INBOX");

      const currentList = await client.search({ all: true });
      const newUids = currentList.filter(id => !processedUids.has(id));

      if (newUids.length > 0) {
        for (const uid of newUids) {
          processedUids.add(uid);
          await processEmail(client, uid);
        }
      }
      await client.logout();
    } catch (_) {
      if (client) { try { await client.logout(); } catch (_) {} }
    }
    await new Promise(r => setTimeout(r, 4000));
  }
}

// ---- API ENDPOINTS ----

// 1. Get all emails with their AI drafts
app.get("/api/emails", (req, res) => {
  const items = Array.from(emailStore.values()).reverse();
  res.json({ emails: items, account: USER });
});

// 2. Re-generate draft with custom instructions
app.post("/api/emails/:uid/regenerate", async (req, res) => {
  const uid = parseInt(req.params.uid, 10);
  const email = emailStore.get(uid);
  if (!email) return res.status(404).json({ error: "Email not found" });

  try {
    const draftText = await generateReply({
      from: email.from,
      subject: email.subject,
      body: email.body,
      yourName: YOUR_NAME,
      yourRole: YOUR_ROLE
    });
    email.aiDraft = draftText;
    emailStore.set(uid, email);
    res.json({ success: true, aiDraft: draftText });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. Send email directly from UI
app.post("/api/emails/:uid/send", async (req, res) => {
  const uid = parseInt(req.params.uid, 10);
  const { editedReply } = req.body;
  const email = emailStore.get(uid);
  if (!email) return res.status(404).json({ error: "Email not found" });

  try {
    const textToSend = editedReply || email.aiDraft;
    await sendReply({
      to: email.from,
      subject: email.subject,
      messageId: email.messageId,
      body: textToSend
    });

    email.status = "sent";
    email.aiDraft = textToSend;
    emailStore.set(uid, email);
    res.json({ success: true, status: "sent" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`\n=================================================`);
  console.log(`  🌐 AI Email Agent Dashboard`);
  console.log(`  👉 Open http://localhost:${PORT} in your browser`);
  console.log(`=================================================\n`);
  startBackgroundWorker();
});
