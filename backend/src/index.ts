import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';
import { stripeRoutes } from './routes/stripe.js';
import { shopifyRoutes } from './routes/shopify.js';
import { ebayRoutes } from './routes/ebay.js';
import { requireAdmin } from './middleware/auth.js';
import { adminRoutes } from './routes/admin/index.js';
import crypto from 'node:crypto';

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(helmet());
app.use(cors());
app.use(morgan('dev'));

// Webhook handling needs raw body, so we conditionally parse JSON
app.use((req, res, next) => {
  if (req.originalUrl === '/api/stripe/webhook') {
    next();
  } else {
    express.json()(req, res, next);
  }
});

// Routes
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use('/api/stripe', stripeRoutes);
app.use('/api/shopify', shopifyRoutes);
app.use('/api/ebay', ebayRoutes);
app.use('/api/admin', requireAdmin, adminRoutes);


app.get('/api/auth/google/start', (req, res) => {
  const clientId = process.env.GOOGLE_CLIENT_ID || ''
  const redirectUri = process.env.GOOGLE_REDIRECT_URI || ''
  const scope = 'openid email profile'
  const from = typeof req.query.from === 'string' ? req.query.from : ''
  const safeFrom = typeof from === 'string' && from.startsWith('/') ? from : ''
  const state = safeFrom || '\/admin'
  if (!clientId || !redirectUri) {
    res.status(500).json({ error: 'Google OAuth not configured' })
    return
  }
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    scope,
    state,
    access_type: 'offline',
    prompt: 'consent'
  })
  const url = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
  res.redirect(url)
})

app.get('/api/auth/google/callback', async (req, res) => {
  const code = (req.query.code as string) || ''
  const state = (req.query.state as string) || ''
  const clientId = process.env.GOOGLE_CLIENT_ID || ''
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET || ''
  const redirectUri = process.env.GOOGLE_REDIRECT_URI || ''
  const adminJwtSecret = process.env.ADMIN_JWT_SECRET || ''
  if (!code || !clientId || !clientSecret || !redirectUri || !adminJwtSecret) {
    res.status(400).json({ error: 'Invalid Google OAuth callback' })
    return
  }
  try {
    const body = new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code'
    })
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString()
    })
    const tokenJson = await tokenRes.json()
    if (!tokenRes.ok) {
      res.status(401).json({ error: 'Google token exchange failed', detail: tokenJson })
      return
    }
    const idToken = tokenJson.id_token as string
    const infoRes = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`)
    const info = await infoRes.json()
    if (!infoRes.ok) {
      res.status(401).json({ error: 'Invalid Google ID token', detail: info })
      return
    }
    if (String(info.aud) !== clientId) {
      res.status(401).json({ error: 'Mismatched audience' })
      return
    }
    const email = String(info.email || '')
    const sub = String(info.sub || '')
    if (!email || !sub) {
      res.status(401).json({ error: 'Missing Google user info' })
      return
    }
    const exp = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60
    const payload = { sub, email, exp, name: String(info.name || '') }
    const json = JSON.stringify(payload)
    const b64 = Buffer.from(json).toString('base64url')
    const sig = crypto.createHmac('sha256', adminJwtSecret).update(b64).digest('base64url')
    const token = `${b64}.${sig}`
    const secure = (process.env.NODE_ENV || '').toLowerCase() === 'production'
    res.cookie('admin_session', token, { httpOnly: true, sameSite: 'lax', secure, path: '/' })
    const dest = typeof state === 'string' && state.startsWith('/') ? state : '/admin'
    res.redirect(dest)
  } catch (e: any) {
    res.status(500).json({ error: 'Google auth error', message: e.message })
  }
})

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  const h = header || ''
  h.split(';').forEach(p => {
    const i = p.indexOf('=')
    if (i > -1) {
      const k = p.slice(0, i).trim()
      const v = p.slice(i + 1).trim()
      if (k) out[k] = v
    }
  })
  return out
}

function readSession(req: express.Request): any | null {
  const cookies = parseCookies(req.header('cookie'))
  const token = cookies['admin_session']
  if (!token) return null
  const secret = process.env.ADMIN_JWT_SECRET || ''
  if (!secret) return null
  const parts = token.split('.')
  if (parts.length !== 2) return null
  const [b64, sig] = parts
  if (!b64 || !sig) return null
  const expectedSig = crypto.createHmac('sha256', secret).update(b64).digest('base64url')
  if (sig !== expectedSig) return null
  try {
    const json = Buffer.from(b64, 'base64url').toString('utf8')
    const payload = JSON.parse(json)
    if (!payload.exp || typeof payload.exp !== 'number') return null
    if (payload.exp < Math.floor(Date.now() / 1000)) return null
    return payload
  } catch {
    return null
  }
}

app.get('/api/auth/me', (req, res) => {
  const session = readSession(req)
  const headerToken = req.header('x-admin-token') || ''
  const expected = process.env.ADMIN_API_TOKEN || ''
  const headerOk = expected && headerToken === expected

  if (!session && !headerOk) {
    res.status(401).json({ authenticated: false })
    return
  }
  
  if (session) {
    res.json({ authenticated: true, user: { email: session.email, name: session.name, sub: session.sub } })
  } else {
    // If authenticated via header token, return a dummy user or just authenticated status
    res.json({ authenticated: true, user: { email: 'dev-admin@local', name: 'Dev Admin', sub: 'dev-admin' } })
  }
})

app.post('/api/auth/logout', (req, res) => {
  const secure = (process.env.NODE_ENV || '').toLowerCase() === 'production'
  res.cookie('admin_session', '', { httpOnly: true, sameSite: 'lax', secure, path: '/', maxAge: 0 })
  res.json({ ok: true })
})

// Root handler
app.get('/', (req, res) => {
  res.json({
    message: 'Up2You API is running',
    docs: '/api/docs', // Placeholder
    health: '/health'
  });
});

// 404 Handler
app.use((req, res, next) => {
  res.status(404).json({
    error: 'Not Found',
    message: `Cannot ${req.method} ${req.originalUrl}`
  });
});

// Global Error Handler
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error(err.stack);
  res.status(500).json({
    error: 'Internal Server Error',
    message: process.env.NODE_ENV === 'production' ? 'An unexpected error occurred' : err.message
  });
});

// Start server
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
