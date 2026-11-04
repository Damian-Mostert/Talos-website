'use strict';

// HTTP demo. Exposes a single brain over a small JSON API so any language or
// front-end can drive it.
//
//   node examples/http-server.js
//   curl http://localhost:8787/state
//   curl -X POST http://localhost:8787/perceive -H "content-type: application/json" -d "{\"text\":\"hello warm friend\"}"

const http = require('node:http');
const { Brain } = require('..');

const { env } = require('./env');
const port = Number(process.env.PORT || 8787);
const brain = new Brain({ sizeGB: Number(env('SIZE_GB', 0.01)), native: env('NATIVE', '1') !== '0' });
brain.start(10);

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'access-control-allow-origin': '*',
  });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => {
      data += chunk;
      if (data.length > 1e6) reject(new Error('body too large'));
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); } catch (err) { reject(err); }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const route = `${req.method} ${url.pathname}`;

    if (route === 'GET /health') {
      return json(res, 200, { ok: true, native: brain.native, neurons: brain.engine.n });
    }

    if (route === 'GET /state') {
      return json(res, 200, brain.state());
    }

    if (route === 'GET /context') {
      return json(res, 200, { context: brain.context() });
    }

    if (route === 'POST /perceive') {
      const body = await readBody(req);
      if (typeof body.text === 'string') {
        const emotion = brain.hear(body.text, body);
        return json(res, 200, { emotion, concepts: brain.activeConcepts(6) });
      }
      if (Array.isArray(body.values)) {
        const emotion = brain.perceive(body.values, body);
        return json(res, 200, { emotion });
      }
      return json(res, 400, { error: 'provide { text } or { values }' });
    }

    if (route === 'POST /remember') {
      const body = await readBody(req);
      if (!body.content) return json(res, 400, { error: 'content is required' });
      const node = brain.remember(body.content, body);
      return json(res, 200, { memory: node });
    }

    if (route === 'POST /recall') {
      const body = await readBody(req);
      const entities = body.entities || (body.query ? [body.query] : []);
      const memories = brain.recall(entities, body);
      return json(res, 200, { memories, formatted: brain.memory.format(memories) });
    }

    if (route === 'POST /learn') {
      const body = await readBody(req);
      if (!body.word) return json(res, 400, { error: 'word is required' });
      const concept = brain.learn(body.word, body.sensory || {}, body.emotion || {}, body.action || null, body.strength ?? 0.5);
      return json(res, 200, { concept: concept ? { label: concept.label, emotion: concept.emotion } : null });
    }

    if (route === 'POST /believe') {
      const body = await readBody(req);
      if (!body.topic || !body.claim) return json(res, 400, { error: 'topic and claim are required' });
      return json(res, 200, { belief: brain.believe(body) });
    }

    if (route === 'POST /step') {
      const body = await readBody(req);
      const count = Math.max(1, Math.min(1000, Number(body.count || 1)));
      brain.tick(count);
      return json(res, 200, { tick: brain.tickCount, emotion: brain.emotionalState() });
    }

    if (route === 'POST /interact') {
      const body = await readBody(req);
      const needs = brain.handleInteraction(body.kind || 'poke', body.intensity ?? 1);
      return json(res, 200, { needs });
    }

    if (route === 'POST /save') {
      const body = await readBody(req);
      const file = body.path || 'neuropile.neuropile';
      const saved = brain.save(file);
      return json(res, 200, { saved });
    }

    return json(res, 404, { error: `no route for ${route}` });
  } catch (err) {
    return json(res, 500, { error: err.message });
  }
});

server.listen(port, () => {
  console.log(`neuropile http listening on http://localhost:${port} (${brain.native ? 'native' : 'JS'} core)`);
});

function shutdown() {
  brain.stop();
  server.close(() => process.exit(0));
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
