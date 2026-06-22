const express = require('express');
const router = express.Router();
const dbModule = require('../db');

router.get('/', (req, res) => {
  const { repository_id } = req.query;
  
  let sql = `
    SELECT s.*, 
      r.name as repository_name,
      (SELECT COUNT(*) FROM changes c WHERE c.service_id = s.id) as change_count
    FROM services s
    LEFT JOIN repositories r ON s.repository_id = r.id
    WHERE 1=1
  `;
  const params = [];
  
  if (repository_id) {
    sql += ' AND s.repository_id = ?';
    params.push(repository_id);
  }
  
  sql += ' ORDER BY s.name';
  
  const services = dbModule.query(sql, params);
  res.json({ data: services });
});

router.get('/dependencies', (req, res) => {
  const deps = dbModule.query(`
    SELECT sd.*, 
      s1.name as from_service_name,
      s2.name as to_service_name,
      r1.name as from_repository_name,
      r2.name as to_repository_name
    FROM service_dependencies sd
    JOIN services s1 ON sd.from_service_id = s1.id
    JOIN services s2 ON sd.to_service_id = s2.id
    LEFT JOIN repositories r1 ON s1.repository_id = r1.id
    LEFT JOIN repositories r2 ON s2.repository_id = r2.id
    ORDER BY s1.name, s2.name
  `);
  res.json({ data: deps });
});

router.get('/dependency-graph', (req, res) => {
  const services = dbModule.query('SELECT * FROM services');
  const deps = dbModule.query('SELECT * FROM service_dependencies');
  
  const nodes = services.map(s => ({
    id: s.id,
    name: s.name,
    repository_id: s.repository_id,
    description: s.description
  }));
  
  const edges = deps.map(d => ({
    from: d.from_service_id,
    to: d.to_service_id,
    type: d.dependency_type,
    description: d.description
  }));
  
  res.json({ data: { nodes, edges } });
});

router.get('/:id', (req, res) => {
  const { id } = req.params;
  const service = dbModule.query(`
    SELECT s.*, r.name as repository_name
    FROM services s
    LEFT JOIN repositories r ON s.repository_id = r.id
    WHERE s.id = ?
  `, [id])[0];
  
  if (!service) {
    return res.status(404).json({ error: '服务不存在' });
  }
  
  const upstreamDeps = dbModule.query(`
    SELECT sd.*, s.name as service_name
    FROM service_dependencies sd
    JOIN services s ON sd.to_service_id = s.id
    WHERE sd.from_service_id = ?
  `, [id]);
  
  const downstreamDeps = dbModule.query(`
    SELECT sd.*, s.name as service_name
    FROM service_dependencies sd
    JOIN services s ON sd.from_service_id = s.id
    WHERE sd.to_service_id = ?
  `, [id]);
  
  const apis = dbModule.query('SELECT * FROM apis WHERE service_id = ? ORDER BY path', [id]);
  
  const tableRefs = dbModule.query(`
    SELECT tr.*, t.name as table_name, t.database_name
    FROM table_references tr
    JOIN db_tables t ON tr.table_id = t.id
    WHERE tr.service_id = ?
  `, [id]);
  
  const recentChanges = dbModule.query(`
    SELECT c.*, rel.name as release_name
    FROM changes c
    JOIN releases rel ON c.release_id = rel.id
    WHERE c.service_id = ?
    ORDER BY c.created_at DESC
    LIMIT 10
  `, [id]);
  
  res.json({
    data: {
      ...service,
      upstream_dependencies: upstreamDeps,
      downstream_dependencies: downstreamDeps,
      apis,
      table_references: tableRefs,
      recent_changes: recentChanges
    }
  });
});

router.post('/', (req, res) => {
  const { name, repository_id, path_prefix, description } = req.body;
  
  if (!name) {
    return res.status(400).json({ error: '服务名称不能为空' });
  }
  
  const existing = dbModule.query('SELECT * FROM services WHERE name = ?', [name])[0];
  if (existing) {
    return res.status(400).json({ error: '服务名称已存在' });
  }
  
  const info = dbModule.run(
    'INSERT INTO services (name, repository_id, path_prefix, description) VALUES (?, ?, ?, ?)',
    [name, repository_id || null, path_prefix || null, description || null]
  );
  
  const service = dbModule.query('SELECT * FROM services WHERE id = ?', [info.lastInsertRowid])[0];
  res.json({ data: service });
});

router.put('/:id', (req, res) => {
  const { id } = req.params;
  const { name, repository_id, path_prefix, description } = req.body;
  
  const existing = dbModule.query('SELECT * FROM services WHERE id = ?', [id])[0];
  if (!existing) {
    return res.status(404).json({ error: '服务不存在' });
  }
  
  dbModule.run(
    'UPDATE services SET name = ?, repository_id = ?, path_prefix = ?, description = ? WHERE id = ?',
    [
      name !== undefined ? name : existing.name,
      repository_id !== undefined ? repository_id : existing.repository_id,
      path_prefix !== undefined ? path_prefix : existing.path_prefix,
      description !== undefined ? description : existing.description,
      id
    ]
  );
  
  const service = dbModule.query('SELECT * FROM services WHERE id = ?', [id])[0];
  res.json({ data: service });
});

router.delete('/:id', (req, res) => {
  const { id } = req.params;
  
  const existing = dbModule.query('SELECT * FROM services WHERE id = ?', [id])[0];
  if (!existing) {
    return res.status(404).json({ error: '服务不存在' });
  }
  
  dbModule.run('DELETE FROM services WHERE id = ?', [id]);
  res.json({ message: '删除成功' });
});

module.exports = router;
