// ============================================
//   📬 gmail.js — Gmail helper functions
//   - imapflow  → reads emails & saves drafts
//   - nodemailer → sends emails directly
// ============================================

const { ImapFlow } = require("imapflow");
const nodemailer = require("nodemailer");

const USER     = process.env.GMAIL_USER;
const PASSWORD = process.env.GMAIL_APP_PASSWORD;

function getTransporter() {
  return nodemailer.createTransport({
    service: "gmail",
    auth: { user: USER, pass: PASSWORD },
  });
}

// ---- Send an email reply directly ----
async function sendReply({ to, subject, messageId, body }) {
  const transporter = getTransporter();
  const info = await transporter.sendMail({
    from: USER,
    to,
    subject: `Re: ${subject.replace(/^Re:\s*/i, "")}`,
    text: body,
    inReplyTo: messageId || undefined,
    references: messageId || undefined,
  });
  return info;
}

// ---- Save reply as a Gmail Draft ----
async function saveDraft({ to, subject, messageId, body }) {
  const client = new ImapFlow({
    host: "imap.gmail.com",
    port: 993,
    secure: true,
    auth: { user: USER, pass: PASSWORD },
    logger: false,
  });

  await client.connect();

  const rawEmail = [
    `From: ${USER}`,
    `To: ${to}`,
    `Subject: Re: ${subject.replace(/^Re:\s*/i, "")}`,
    messageId ? `In-Reply-To: ${messageId}` : "",
    messageId ? `References: ${messageId}` : "",
    `Content-Type: text/plain; charset=utf-8`,
    "",
    body,
  ].filter(Boolean).join("\r\n");

  await client.append("[Gmail]/Drafts", rawEmail, ["\\Draft", "\\Seen"]);
  await client.logout();
}

// ---- Mark email as read in INBOX ----
async function markAsRead(uid) {
  const client = new ImapFlow({
    host: "imap.gmail.com",
    port: 993,
    secure: true,
    auth: { user: USER, pass: PASSWORD },
    logger: false,
  });

  await client.connect();
  await client.mailboxOpen("INBOX");
  await client.messageFlagsAdd({ uid }, ["\\Seen"]);
  await client.logout();
}

module.exports = { sendReply, saveDraft, markAsRead };
