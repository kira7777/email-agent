// ============================================
//   📧 AI Email Agent — Robust Active Mailbox Checker
//   - Opens clean session per check cycle to guarantee fresh inbox sync
//   - No persistent socket hang / no stale cache
//   - Gemini 3.5 Flash / 3.1 Flash Lite smart response
// ============================================

require("dotenv").config();
const { ImapFlow } = require("imapflow");
const { generateReply } = require("./ai");
const { saveDraft } = require("./gmail");

const USER      = process.env.GMAIL_USER;
const PASSWORD  = process.env.GMAIL_APP_PASSWORD;
const YOUR_NAME = process.env.YOUR_NAME || "Ahmed";
const YOUR_ROLE = process.env.YOUR_ROLE || "Oracle APEX Technical Consultant";

// Set of processed UIDs
const processedUids = new Set();

function createClient() {
  return new ImapFlow({
    host: "imap.gmail.com",
    port: 993,
    secure: true,
    auth: { user: USER, pass: PASSWORD },
    logger: false,
    emitLogs: false,
    clientInfo: { name: "email-agent", version: "1.0.0" }
  });
}

async function processEmail(client, uid) {
  try {
    const messages = [];
    for await (const msg of client.fetch([uid], {
      envelope: true,
      source: true,
    })) {
      messages.push(msg);
    }

    if (messages.length === 0) return;
    const msg = messages[0];

    const from      = msg.envelope.from?.[0]?.address || "";
    const subject   = msg.envelope.subject || "(No Subject)";
    const messageId = msg.envelope.messageId || "";
    const body      = extractText(msg.source.toString()).slice(0, 2000);

    // Ignore self-sent emails
    if (from.toLowerCase() === USER.toLowerCase()) {
      return;
    }

    console.log(`\n📨 [NEW EMAIL RECEIVED]`);
    console.log(`   From: ${from}`);
    console.log(`   Subject: ${subject}`);

    // Generate AI response
    const reply = await generateReply({
      from,
      subject,
      body,
      yourName: YOUR_NAME,
      yourRole: YOUR_ROLE,
    });
    console.log(`   ✍️  Reply drafted`);

    // Save as draft in Gmail
    await saveDraft({ to: from, subject, messageId, body: reply });

    // Mark original as seen in Gmail
    try {
      await client.messageFlagsAdd({ uid }, ["\\Seen"]);
    } catch (_) {}

    console.log(`   📝 Draft successfully saved in Gmail Drafts! Check it now.\n`);

  } catch (err) {
    console.error(`   ❌ Error processing email (UID: ${uid}):`, err.message);
  }
}

async function startAgent() {
  console.log("========================================");
  console.log("  📧 AI Email Agent — Active Checker");
  console.log(`  Account: ${USER}`);
  console.log("========================================\n");

  // Initial connect to index all existing messages
  let initClient = createClient();
  await initClient.connect();
  await initClient.mailboxOpen("INBOX");
  const allInitial = await initClient.search({ all: true });
  allInitial.forEach(id => processedUids.add(id));
  console.log(`[${new Date().toLocaleTimeString()}] 🟢 Initialized. Indexed ${allInitial.length} existing emails.`);
  console.log("   Now actively checking for newly arriving emails every 5 seconds...\n");
  await initClient.logout();

  // Polling loop with fresh status queries
  while (true) {
    let client = null;
    try {
      client = createClient();
      await client.connect();
      await client.mailboxOpen("INBOX");

      // Check current mailbox status
      const currentList = await client.search({ all: true });
      const newUids = currentList.filter(id => !processedUids.has(id));

      if (newUids.length > 0) {
        console.log(`🔔 Found ${newUids.length} new incoming email(s)! Processing...`);
        for (const uid of newUids) {
          processedUids.add(uid);
          await processEmail(client, uid);
        }
      }

      await client.logout();
    } catch (err) {
      if (client) {
        try { await client.logout(); } catch (_) {}
      }
      // Brief pause if connection fluctuates
      await new Promise(r => setTimeout(r, 2000));
    }

    // Wait 5 seconds before the next check
    await new Promise(r => setTimeout(r, 5000));
  }
}

function extractText(raw) {
  const match = raw.match(/Content-Type: text\/plain[\s\S]*?\r?\n\r?\n([\s\S]*?)(\r?\n--|\s*$)/i);
  if (match) return match[1].trim();
  const bodyStart = raw.indexOf("\r\n\r\n");
  if (bodyStart !== -1) return raw.slice(bodyStart + 4).trim();
  return raw.trim();
}

startAgent();
