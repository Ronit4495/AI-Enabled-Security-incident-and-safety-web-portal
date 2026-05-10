const express = require('express');
const cors    = require('cors');
const fetch   = require('node-fetch');
const path    = require('path');

const app  = express();
const PORT = 3000;

// ══════════════════════════════════════════════
//  API KEYS
// ══════════════════════════════════════════════
const GROQ_API_KEY       = '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';
const VIRUSTOTAL_API_KEY = '45699f958dd465b5fdfe3f0ddd328adaf53f5158b7159c9d6f1c02e3ef7c5737';
const URLSCAN_API_KEY    = '019d9628-abc7-7424-b4d2-a8cec04c6364';

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));


// ══════════════════════════════════════════════
//  1. GROQ CHATBOT
// ══════════════════════════════════════════════
app.post('/api/chat', async (req, res) => {
  try {
    const { max_tokens, system, messages } = req.body;
    console.log('\n📨 Groq request — Messages:', messages.length);

    const groqMessages = [
      { role: 'system', content: system },
      ...messages
    ];

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': 'Bearer ' + GROQ_API_KEY
      },
      body: JSON.stringify({
        model:      'llama-3.3-70b-versatile',
        max_tokens: max_tokens || 1000,
        messages:   groqMessages
      })
    });

    const data = await response.json();
    console.log('📩 Groq status:', response.status);

    if (!response.ok) {
      console.error('❌ Groq Error:', data?.error?.message);
      return res.status(response.status).json({ error: data?.error?.message });
    }

    const converted = {
      content: [{ type: 'text', text: data.choices[0].message.content }]
    };

    console.log('✅ Groq reply sent.');
    res.json(converted);

  } catch (err) {
    console.error('💥 Groq server error:', err.message);
    res.status(500).json({ error: err.message });
  }
});


// ══════════════════════════════════════════════
//  2. VIRUSTOTAL — Scans URL against 90+ engines
//  GET /api/virustotal?url=https://example.com
// ══════════════════════════════════════════════
app.get('/api/virustotal', async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ error: 'No URL provided' });

  try {
    console.log('\n🦠 VirusTotal: Submitting URL:', url);

    const submitRes = await fetch('https://www.virustotal.com/api/v3/urls', {
      method: 'POST',
      headers: {
        'x-apikey':     VIRUSTOTAL_API_KEY,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({ url }).toString()
    });

    const submitData = await submitRes.json();

    if (!submitRes.ok) {
      console.error('❌ VT Submit Error:', submitData?.error?.message);
      return res.json({ checked: false, error: submitData?.error?.message });
    }

    const analysisId = submitData.data.id;
    console.log('⏳ VirusTotal: Waiting 8s for analysis to complete...');
    await new Promise(r => setTimeout(r, 8000));

    let stats = null;
    const maxAttempts = 5;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const analysisRes = await fetch(
        `https://www.virustotal.com/api/v3/analyses/${analysisId}`,
        { headers: { 'x-apikey': VIRUSTOTAL_API_KEY } }
      );
      const analysisData = await analysisRes.json();
      const status = analysisData.data?.attributes?.status;

      console.log(`🔄 Analysis status (attempt ${attempt}/${maxAttempts}): ${status}`);

      if (status === 'completed') {
        stats = analysisData.data?.attributes?.stats;
        console.log('✅ Analysis completed. Stats:', JSON.stringify(stats));
        break;
      }

      if (attempt < maxAttempts) {
        await new Promise(r => setTimeout(r, 3000));
      }
    }

    if (!stats || (stats.malicious === 0 && stats.suspicious === 0 && stats.harmless === 0)) {
      console.log('⚠️  Using URL report endpoint for reliable last_analysis_stats...');

      const urlId = Buffer.from(url).toString('base64')
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

      const reportRes = await fetch(
        `https://www.virustotal.com/api/v3/urls/${urlId}`,
        { headers: { 'x-apikey': VIRUSTOTAL_API_KEY } }
      );

      if (reportRes.ok) {
        const reportData = await reportRes.json();
        const reportStats = reportData.data?.attributes?.last_analysis_stats;
        if (reportStats) {
          stats = reportStats;
          console.log('✅ Got reliable stats from URL report. Stats:', JSON.stringify(stats));
        }
      }
    }

    if (!stats) {
      console.error('❌ VT: Could not retrieve stats from any endpoint');
      return res.json({ checked: false, error: 'No stats returned from VirusTotal' });
    }

    const total = (stats.malicious  || 0) + (stats.suspicious || 0) +
                  (stats.harmless   || 0) + (stats.undetected || 0);

    console.log(`✅ Final — Malicious: ${stats.malicious}, Suspicious: ${stats.suspicious}, Harmless: ${stats.harmless}, Total: ${total}`);

    res.json({
      checked:    true,
      malicious:  stats.malicious  || 0,
      suspicious: stats.suspicious || 0,
      harmless:   stats.harmless   || 0,
      undetected: stats.undetected || 0,
      total:      total,
      isSafe:     (stats.malicious === 0) && (stats.suspicious === 0),
      reportURL:  `https://www.virustotal.com/gui/url/${Buffer.from(url).toString('base64').replace(/=+$/, '')}`
    });

  } catch (err) {
    console.error('❌ VirusTotal error:', err.message);
    res.json({ checked: false, error: err.message });
  }
});


// ══════════════════════════════════════════════
//  3. URLSCAN.IO — Screenshot + threat intel scan
//  GET /api/urlscan?url=https://example.com
//
//  Flow:
//    1. Submit URL → get UUID
//    2. Poll /result/{uuid} until ready (up to ~45s total)
//    3. Return verdict, screenshot URL, categories, report link
// ══════════════════════════════════════════════
app.get('/api/urlscan', async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ error: 'No URL provided' });

  try {
    console.log('\n🔍 URLScan.io: Submitting URL:', url);

    // Step 1: Submit scan
    const submitRes = await fetch('https://urlscan.io/api/v1/scan/', {
      method: 'POST',
      headers: {
        'API-Key':      URLSCAN_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ url: url, visibility: 'public' })
    });

    const submitData = await submitRes.json();

    if (!submitRes.ok) {
      const msg = submitData?.message || submitData?.description || 'URLScan submission failed';
      console.error('❌ URLScan Submit Error:', msg);
      return res.json({ checked: false, error: msg });
    }

    const scanUuid  = submitData.uuid;
    const resultUrl = submitData.result;
    const apiResult = `https://urlscan.io/api/v1/result/${scanUuid}/`;

    console.log('⏳ URLScan.io: UUID:', scanUuid, '— waiting 15s...');
    await new Promise(r => setTimeout(r, 15000));

    // Step 2: Poll for result
    let resultData = null;
    const maxAttempts = 6;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const resultRes = await fetch(apiResult, {
        headers: { 'API-Key': URLSCAN_API_KEY }
      });

      if (resultRes.status === 404) {
        console.log(`⏳ URLScan not ready (attempt ${attempt}/${maxAttempts}), waiting 5s...`);
        if (attempt < maxAttempts) await new Promise(r => setTimeout(r, 5000));
        continue;
      }

      if (!resultRes.ok) {
        console.error('❌ URLScan result error:', resultRes.status);
        break;
      }

      resultData = await resultRes.json();
      console.log('✅ URLScan.io: Result ready.');
      break;
    }

    // Timeout — return pending state with link
    if (!resultData) {
      console.warn('⚠️  URLScan.io result not ready in time.');
      return res.json({
        checked:   false,
        pending:   true,
        reportURL: resultUrl,
        uuid:      scanUuid,
        error:     'Scan still processing — check the report link shortly.'
      });
    }

    // Step 3: Extract key fields
    const verdicts  = resultData.verdicts?.overall   || {};
    const page      = resultData.page                || {};
    const stats     = resultData.stats               || {};

    const malicious  = verdicts.malicious  || false;
    const score      = verdicts.score      || 0;
    const categories = verdicts.categories || [];
    const brands     = verdicts.brands     || [];
    const tags       = resultData.verdicts?.urlscan?.tags || [];

    const urlscanMalicious = resultData.verdicts?.urlscan?.malicious || false;
    const urlscanScore     = resultData.verdicts?.urlscan?.score     || 0;
    const communityScore   = resultData.verdicts?.community?.score   || 0;

    console.log(`✅ URLScan verdict — Malicious: ${malicious}, Score: ${score}, Categories: ${categories.join(', ')}`);

    res.json({
      checked:          true,
      malicious:        malicious,
      score:            score,
      categories:       categories,
      brands:           brands,
      tags:             tags,
      urlscanMalicious: urlscanMalicious,
      urlscanScore:     urlscanScore,
      communityScore:   communityScore,
      page: {
        domain:  page.domain  || '',
        country: page.country || '',
        server:  page.server  || '',
        ip:      page.ip      || '',
        asn:     page.asn     || '',
        asnname: page.asnname || ''
      },
      stats: {
        requests:   stats.requests   || 0,
        domains:    stats.domains    || 0,
        dataLength: stats.dataLength || 0
      },
      screenshot: `https://urlscan.io/screenshots/${scanUuid}.png`,
      reportURL:  resultUrl,
      uuid:       scanUuid
    });

  } catch (err) {
    console.error('❌ URLScan.io error:', err.message);
    res.json({ checked: false, error: err.message });
  }
});


// ══════════════════════════════════════════════
//  START SERVER
// ══════════════════════════════════════════════
app.listen(PORT, () => {
  console.log('\n  ╔══════════════════════════════════════════╗');
  console.log('  ║   🛡️  Cyber Saarthi Server Running!       ║');
  console.log('  ║   Open: http://localhost:3000            ║');
  console.log('  ╚══════════════════════════════════════════╝\n');
  console.log('  📡 Active Routes:');
  console.log('     POST /api/chat              → Groq Chatbot');
  console.log('     GET  /api/virustotal?url=   → VirusTotal Scan');
  console.log('     GET  /api/urlscan?url=      → URLScan.io Scan\n');
});
