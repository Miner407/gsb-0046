const express = require('express');
const router = express.Router();
const dbModule = require('../db');

router.get('/', (req, res) => {
  const repos = dbModule.query(`
    SELECT r.*, 
      (SELECT COUNT(*) FROM services s WHERE s.repository_id = r.id) as service_count,
      (SELECT COUNT(*) FROM changes c WHERE c.repository_id = r.id) as change_count
    FROM repositories r
    ORDER BY r.name
  `);
  res.json({ data: repos });
});

router.get('/:id', (req, res) => {
  const { id } = req.params;
  const repo = dbModule.query('SELECT * FROM repositories WHERE id = ?', [id])[0];
  
  if (!repo) {
    return res.status(404).json({ error: '仓库不存在' });
  }
  
  const services = dbModule.query('SELECT * FROM services WHERE repository_id = ? ORDER BY name', [id]);
  const changes = dbModule.query('SELECT * FROM changes WHERE repository_id = ? ORDER BY created_at DESC LIMIT 10', [id]);
  
  res.json({
    data: {
      ...repo,
      services,
      recent_changes: changes
    }
  });
});

router.post('/', (req, res) => {
  const { name, url, description } = req.body;
  
  if (!name) {
    return res.status(400).json({ error: '仓库名称不能为空' });
  }
  
  const existing = dbModule.query('SELECT * FROM repositories WHERE name = ?', [name])[0];
  if (existing) {
    return res.status(400).json({ error: '仓库名称已存在' });
  }
  
  const info = dbModule.run(
    'INSERT INTO repositories (name, url, description) VALUES (?, ?, ?)',
    [name, url || null, description || null]
  );
  
  const repo = dbModule.query('SELECT * FROM repositories WHERE id = ?', [info.lastInsertRowid])[0];
  res.json({ data: repo });
});

router.put('/:id', (req, res) => {
  const { id } = req.params;
  const { name, url, description } = req.body;
  
  const existing = dbModule.query('SELECT * FROM repositories WHERE id = ?', [id])[0];
  if (!existing) {
    return res.status(404).json({ error: '仓库不存在' });
  }
  
  dbModule.run(
    'UPDATE repositories SET name = ?, url = ?, description = ? WHERE id = ?',
    [
      name !== undefined ? name : existing.name,
      url !== undefined ? url : existing.url,
      description !== undefined ? description : existing.description,
      id
    ]
  );
  
  const repo = dbModule.query('SELECT * FROM repositories WHERE id = ?', [id])[0];
  res.json({ data: repo });
});

router.delete('/:id', (req, res) => {
  const { id } = req.params;
  
  const existing = dbModule.query('SELECT * FROM repositories WHERE id = ?', [id])[0];
  if (!existing) {
    return res.status(404).json({ error: '仓库不存在' });
  }
  
  dbModule.run('DELETE FROM repositories WHERE id = ?', [id]);
  res.json({ message: '删除成功' });
});

module.exports = router;
