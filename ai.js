// ============================================
//   🤖 ai.js — Smart AI reply generator
//   Uses ultra-fast Gemini 3.5 Flash / 3.1 Flash Lite
// ============================================

const { GoogleGenerativeAI } = require("@google/generative-ai");

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const primaryModel = genAI.getGenerativeModel({ model: "gemini-3.5-flash" });
const fallbackModel = genAI.getGenerativeModel({ model: "gemini-3.1-flash-lite" });

async function generateReply({ from, subject, body, yourName, yourRole }) {
  const prompt = `
You are an AI assistant replying to emails on behalf of ${yourName}, who is an ${yourRole}.

Write a professional, concise, and friendly email reply.
- Keep it short (2-3 sentences)
- Be polite and helpful
- Sign off with "${yourName}"
- Do NOT include any subject line or headers, only the body text

Here is the email received:
---
From: ${from}
Subject: ${subject}
Message:
${body}
---

Write ONLY the reply body text:
`;

  try {
    const result = await primaryModel.generateContent(prompt);
    return result.response.text().trim();
  } catch (err) {
    console.log(`   Switching to lightweight model (gemini-3.1-flash-lite)...`);
    const fallbackResult = await fallbackModel.generateContent(prompt);
    return fallbackResult.response.text().trim();
  }
}

module.exports = { generateReply };
