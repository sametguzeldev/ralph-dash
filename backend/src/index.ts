import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { initializeDatabase } from './db/schema.js';
import { settingsRouter } from './routes/settings.js';
import { projectsRouter } from './routes/projects.js';
import { runnerRouter } from './routes/runner.js';
import { workflowRouter } from './routes/workflow.js';
import { modelsRouter } from './routes/models.js';
import { reviewRouter } from './routes/review.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const PORT = process.env.PORT || 3001;

const DEFAULT_ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
];

const envOrigins = (process.env.CORS_ORIGINS ?? process.env.FRONTEND_ORIGIN ?? '')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);

const allowedOrigins = new Set([...DEFAULT_ALLOWED_ORIGINS, ...envOrigins]);

app.use(cors({
  origin: (origin, callback) => {
    // Same-origin or non-browser (curl, server-to-server) requests have no Origin header.
    if (!origin) return callback(null, true);
    if (allowedOrigins.has(origin)) return callback(null, true);
    return callback(new Error(`Origin not allowed by CORS: ${origin}`));
  },
  credentials: true,
}));
app.use(express.json());

initializeDatabase();

app.use('/api/settings', settingsRouter);
app.use('/api/projects', projectsRouter);
app.use('/api/projects', runnerRouter);
app.use('/api/projects', workflowRouter);
app.use('/api/projects', reviewRouter);
app.use('/api/models', modelsRouter);

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// Serve frontend static files in production
if (process.env.NODE_ENV === 'production') {
  const publicDir = path.join(__dirname, '..', 'public');
  app.use(express.static(publicDir));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(publicDir, 'index.html'));
  });
}

app.listen(PORT, () => {
  console.log(`RalphDash backend running on port ${PORT}`);
});
