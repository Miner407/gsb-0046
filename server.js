const express = require('express');
const cors = require('cors');
const path = require('path');
const dbModule = require('./db');

const releasesRoute = require('./routes/releases');
const changesRoute = require('./routes/changes');
const repositoriesRoute = require('./routes/repositories');
const servicesRoute = require('./routes/services');
const impactRoute = require('./routes/impact');
const statisticsRoute = require('./routes/statistics');

const app = express();
const PORT = process.env.PORT || 3000;
const dbPath = path.join(__dirname, 'data', 'app.db');

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

async function startServer() {
  try {
    await dbModule.initDb(dbPath);
    console.log('Database initialized successfully');
  } catch (err) {
    console.error('Failed to initialize database:', err);
    process.exit(1);
  }

  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', message: '发布变更影响分析平台运行正常' });
  });

  app.use('/api/releases', releasesRoute);
  app.use('/api/changes', changesRoute);
  app.use('/api/repositories', repositoriesRoute);
  app.use('/api/services', servicesRoute);
  app.use('/api/impact', impactRoute);
  app.use('/api/statistics', statisticsRoute);

  app.use((err, req, res, next) => {
    console.error('Server error:', err);
    res.status(500).json({ error: '服务器内部错误' });
  });

  app.use((req, res) => {
    res.status(404).json({ error: '接口不存在' });
  });

  app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
    console.log(`API base URL: http://localhost:${PORT}/api`);
  });
}

startServer();

process.on('SIGINT', () => {
  console.log('\nSaving database...');
  dbModule.saveDb();
  console.log('Database saved. Exiting.');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\nSaving database...');
  dbModule.saveDb();
  console.log('Database saved. Exiting.');
  process.exit(0);
});

setInterval(() => {
  try {
    dbModule.saveDb();
  } catch (err) {
    console.error('Failed to save database periodically:', err);
  }
}, 30000);

module.exports = app;
