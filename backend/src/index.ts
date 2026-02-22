import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { initializeDatabase } from './db/schema.js';
import { settingsRouter } from './routes/settings.js';
import { projectsRouter } from './routes/projects.js';
import { runnerRouter } from './routes/runner.js';
import { workflowRouter } from './routes/workflow.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

initializeDatabase();

app.use('/api/settings', settingsRouter);
app.use('/api/projects', projectsRouter);
app.use('/api/projects', runnerRouter);
app.use('/api/projects', workflowRouter);

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
