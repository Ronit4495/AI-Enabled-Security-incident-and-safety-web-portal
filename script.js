/* ============================================================
   NATIONAL CYBER CRIME REPORTING PORTAL — script.js
   Government of India · Ministry of Home Affairs · I4C
   ============================================================ */

/* ══════════════════════════════════════
   PORTAL GENERAL FUNCTIONALITY
   ══════════════════════════════════════ */

// Language switcher (header)
document.querySelectorAll('.lang-switcher span').forEach(btn => {
  btn.addEventListener('click', function () {
    document.querySelectorAll('.lang-switcher span').forEach(b => b.classList.remove('active'));
    this.classList.add('active');
  });
});

// Nav active state
document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', function () {
    document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
    this.classList.add('active');
  });
});

// Crime card highlight + scroll to form
function highlightCategory(card) {
  document.querySelectorAll('.crime-card').forEach(c => c.style.borderLeftColor = 'transparent');
  card.style.borderLeftColor = '#FF9933';
  document.querySelector('.form-section').scrollIntoView({ behavior: 'smooth' });
}

// Complaint form submit
function submitComplaint(e) {
  e.preventDefault();
  const num = Math.floor(10000 + Math.random() * 90000);
  document.getElementById('casenum').textContent = num;
  const toast = document.getElementById('toast');
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 5000);
  e.target.reset();
}

// Track complaint
function trackComplaint() {
  const input = document.querySelector('.track-form input').value.trim();
  if (!input) { alert('Please enter a Complaint ID'); return; }
  alert(
    'Tracking complaint: ' + input +
    '\n\nStatus: Under Investigation\nAssigned To: Delhi Cyber Cell\nLast Updated: Today'
  );
}

// CAPTCHA refresh
const captchas = ['X7K2M9', 'B4P8Q1', 'M3R6Y2', 'K9T5W7', 'Z2N8D4'];
let capIdx = 0;
function refreshCaptcha() {
  capIdx = (capIdx + 1) % captchas.length;
  document.querySelector('.captcha-img').textContent = captchas[capIdx];
}

// File upload feedback
document.querySelector('.file-upload input').addEventListener('change', function () {
  const p = this.closest('.file-upload').querySelector('p');
  if (this.files.length > 0) {
    p.textContent = `${this.files.length} file(s) selected: ${Array.from(this.files).map(f => f.name).join(', ')}`;
    p.style.color = '#138808';
  }
});


/* ══════════════════════════════════════
   CYBER SAARTHI — AI CHATBOT
   ══════════════════════════════════════ */

// ── State ──
let chatOpen  = false;
let chatLang  = 'en';
let chatHistory = [];
let isTyping  = false;

// ── System Prompt ──
const SYSTEM_PROMPT = `You are "Cyber Saarthi", an expert AI assistant for India's National Cyber Crime Reporting Portal. You help Indian citizens understand, prevent, and report cyber crimes and online fraud.

Your expertise covers:
- All types of cyber crimes: UPI fraud, phishing, vishing, smishing, ransomware, sextortion, job scams, loan app fraud, investment scams, online shopping fraud, social media crimes, hacking, data breach, identity theft
- How to report cyber crimes in India (cybercrime.gov.in portal, 1930 helpline, local police)
- Indian laws related to cyber crime: IT Act 2000, IT Amendment Act 2008, IPC sections (66, 66C, 66D, 67, 420, etc.), BNSS
- Immediate steps to take after becoming a victim
- Preventive measures and cyber safety tips
- I4C (Indian Cyber Crime Coordination Centre), CERT-In, RBI cybersecurity guidelines
- How to freeze fraudulent transactions, evidence preservation, dealing with banks

Guidelines:
- Always respond in a helpful, empathetic, and clear manner
- If someone is in active financial fraud: IMMEDIATELY tell them to call 1930 and contact their bank to freeze transactions
- For emergencies, always mention the 1930 helpline
- Keep responses concise but complete — use bullet points for steps
- If asked in Hindi or about Hindi support, respond in simple Hindi/Hinglish
- Never provide legal advice as a lawyer; guide to appropriate authorities
- For CSAM or serious crimes, direct to immediate reporting
- Be sensitive to victims — they may be stressed or in crisis`;

// ── Init: Show welcome message on page load ──
window.addEventListener('load', () => {
  setTimeout(() => addBotMessage(getBotWelcome()), 800);
});

// ── Welcome HTML ──
function getBotWelcome() {
  return `<strong>Namaste! 🙏 I'm Cyber Saarthi</strong><br><br>
I'm your AI-powered cyber crime assistant. I can help you with:<br>
• Identifying scams &amp; frauds<br>
• Steps to take if you're a victim<br>
• How to report cyber crimes<br>
• Cyber safety tips &amp; prevention<br><br>
<strong>Been defrauded?</strong>
<div class="helpline-mini"><div>🚨 Call immediately:</div><div class="num">1930</div><div>· Financial Cyber Fraud Helpline</div></div>`;
}

// ── Toggle chat window ──
function toggleChat() {
  chatOpen = !chatOpen;
  const win = document.getElementById('chatWindow');
  const btn = document.getElementById('chatBubbleBtn');
  const dot = document.getElementById('notifDot');

  win.classList.toggle('open', chatOpen);
  btn.classList.toggle('open', chatOpen);

  if (chatOpen) {
    dot.style.display = 'none';
    setTimeout(() => document.getElementById('chatInput').focus(), 300);
  }
}

// ── Language switcher (chatbot) ──
function setLang(lang) {
  chatLang = lang;
  document.getElementById('langEN').classList.toggle('active', lang === 'en');
  document.getElementById('langHI').classList.toggle('active', lang === 'hi');
}

// ── Send message to Claude API ──
async function sendMessage() {
  const input = document.getElementById('chatInput');
  const text  = input.value.trim();
  if (!text || isTyping) return;

  input.value = '';
  input.style.height = 'auto';
  addUserMessage(text);
  document.getElementById('sendBtn').disabled = true;

  const typingId = showTyping();
  isTyping = true;

  try {
    chatHistory.push({
      role: 'user',
      content: text + (chatLang === 'hi' ? ' (Please respond in Hindi/Hinglish if possible)' : '')
    });

    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1000,
        system: SYSTEM_PROMPT,
        messages: chatHistory.slice(-10)   // keep last 10 turns for context
      })
    });

    const data = await response.json();
    removeTyping(typingId);

    const reply = data.content?.[0]?.text
      || 'I apologize, I could not process your request. Please try again or call 1930 for assistance.';
    chatHistory.push({ role: 'assistant', content: reply });

    addBotMessage(formatResponse(reply));

    // Auto-append emergency helpline card if fraud keywords detected
    const lower = text.toLowerCase();
    const fraudKeywords = ['fraud', 'scam', 'money', 'upi', 'transfer', 'lost', 'cheated', 'hack'];
    if (fraudKeywords.some(k => lower.includes(k)) && !reply.includes('1930')) {
      addBotMessage(
        `<div class="helpline-mini">🚨 <div><strong>Emergency?</strong> Call <span class="num">1930</span> now to freeze fraudulent transactions before it's too late.</div></div>`
      );
    }

  } catch (err) {
    removeTyping(typingId);
    addBotMessage(
      `<div class="alert-card"><strong>⚠️ Connection Issue</strong>Unable to reach AI. For immediate help: Call <strong>1930</strong> (Financial Fraud) or visit cybercrime.gov.in</div>`
    );
  }

  isTyping = false;
  document.getElementById('sendBtn').disabled = false;
}

// ── Format markdown-like response into HTML ──
function formatResponse(text) {
  return text
    .replace(/\*\*(.*?)\*\*/g,  '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g,      '<em>$1</em>')
    .replace(/^### (.*)/gm,     '<strong style="color:#002366;font-size:14px;">$1</strong>')
    .replace(/^## (.*)/gm,      '<strong style="color:#002366;font-size:15px;">$1</strong>')
    .replace(/^# (.*)/gm,       '<strong style="color:#002366;font-size:16px;">$1</strong>')
    .replace(/^- (.*)/gm,       '• $1')
    .replace(/^\d+\. (.*)/gm, (m, p1, offset, str) => {
      const num = str.substring(0, offset).split('\n').filter(l => /^\d+\./.test(l)).length + 1;
      return `<strong>${num}.</strong> $1`;
    })
    .replace(/\n\n/g, '<br><br>')
    .replace(/\n/g,   '<br>')
    .replace(/1930/g, '<strong style="color:#c62828;">1930</strong>');
}

// ── Send a quick-topic chip message ──
function sendQuick(text) {
  document.getElementById('chatInput').value = text;
  sendMessage();
}

// ── Add user bubble ──
function addUserMessage(text) {
  const msgs = document.getElementById('chatMessages');
  const time = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  const div  = document.createElement('div');
  div.className = 'msg user';
  div.innerHTML = `
    <div>
      <div class="msg-bubble">${escapeHtml(text)}</div>
      <div class="msg-time">${time}</div>
    </div>
    <div class="msg-avatar">👤</div>
  `;
  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
  animateIn(div, 'right');
}

// ── Add bot bubble ──
function addBotMessage(html) {
  const msgs = document.getElementById('chatMessages');
  const time = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  const div  = document.createElement('div');
  div.className = 'msg bot';
  div.innerHTML = `
    <div class="msg-avatar">🤖</div>
    <div>
      <div class="msg-bubble">${html}</div>
      <div class="msg-time">${time} · Cyber Saarthi</div>
    </div>
  `;
  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
  animateIn(div, 'left');
}

// ── Animate message slide-in ──
function animateIn(el, direction) {
  el.style.opacity = '0';
  el.style.transform = direction === 'right' ? 'translateX(20px)' : 'translateX(-20px)';
  requestAnimationFrame(() => {
    el.style.transition = 'all 0.3s ease';
    el.style.opacity = '1';
    el.style.transform = 'translateX(0)';
  });
}

// ── Show typing dots ──
function showTyping() {
  const msgs = document.getElementById('chatMessages');
  const id   = 'typing_' + Date.now();
  const div  = document.createElement('div');
  div.className = 'msg bot';
  div.id = id;
  div.innerHTML = `
    <div class="msg-avatar">🤖</div>
    <div class="msg-bubble" style="padding:12px 16px;">
      <div class="typing-indicator"><span></span><span></span><span></span></div>
    </div>
  `;
  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
  return id;
}

// ── Remove typing dots ──
function removeTyping(id) {
  const el = document.getElementById(id);
  if (el) el.remove();
}

// ── Clear chat ──
function clearChat() {
  chatHistory = [];
  document.getElementById('chatMessages').innerHTML = '';
  setTimeout(() => addBotMessage(getBotWelcome()), 200);
}

// ── Keyboard shortcut: Enter to send, Shift+Enter for newline ──
function handleKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
}

// ── Auto-resize textarea as user types ──
function autoResize(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 100) + 'px';
}

// ── HTML escape to prevent XSS ──
function escapeHtml(text) {
  return text
    .replace(/&/g,  '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/"/g,  '&quot;');
}
