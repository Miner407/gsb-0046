const express = require('express');
const router = express.Router();
const dbModule = require('../db');

router.get('/', (req, res) => {
  const { status, keyword } = req.query;
  
  let sql = `
    SELECT r.*, 
      (SELECT COUNT(*) FROM changes c WHERE c.release_id = r.id) as change_count,
      (SELECT COUNT(*) FROM changes c WHERE c.release_id = r.id AND c.confirmed = 1) as confirmed_count,
      (SELECT COUNT(*) FROM changes c WHERE c.release_id = r.id AND c.risk_level = 'high') as high_risk_count
    FROM releases r
    WHERE 1=1
  `;
  const params = [];
  
  if (status) {
    sql += ' AND r.status = ?';
    params.push(status);
  }
  
  if (keyword) {
    sql += ' AND (r.name LIKE ? OR r.description LIKE ?)';
    params.push(`%${keyword}%`, `%${keyword}%`);
  }
  
  sql += ' ORDER BY r.created_at DESC';
  
  const releases = dbModule.query(sql, params);
  res.json({ data: releases });
});

router.get('/:id', (req, res) => {
  const { id } = req.params;
  const release = dbModule.query('SELECT * FROM releases WHERE id = ?', [id])[0];
  
  if (!release) {
    return res.status(404).json({ error: '发布单不存在' });
  }
  
  const changeCount = dbModule.query('SELECT COUNT(*) as count FROM changes WHERE release_id = ?', [id])[0].count;
  const confirmedCount = dbModule.query('SELECT COUNT(*) as count FROM changes WHERE release_id = ? AND confirmed = 1', [id])[0].count;
  const highRiskCount = dbModule.query('SELECT COUNT(*) as count FROM changes WHERE release_id = ? AND risk_level = "high"', [id])[0].count;
  
  res.json({
    data: {
      ...release,
      change_count: changeCount,
      confirmed_count: confirmedCount,
      high_risk_count: highRiskCount
    }
  });
});

router.post('/', (req, res) => {
  const { name, version, status = 'pending', planned_date, description } = req.body;
  
  if (!name) {
    return res.status(400).json({ error: '发布单名称不能为空' });
  }
  
  const info = dbModule.run(
    'INSERT INTO releases (name, version, status, planned_date, description) VALUES (?, ?, ?, ?, ?)',
    [name, version || null, status, planned_date || null, description || null]
  );
  
  const release = dbModule.query('SELECT * FROM releases WHERE id = ?', [info.lastInsertRowid])[0];
  res.json({ data: release });
});

router.put('/:id', (req, res) => {
  const { id } = req.params;
  const { name, version, status, planned_date, description } = req.body;
  
  const existing = dbModule.query('SELECT * FROM releases WHERE id = ?', [id])[0];
  if (!existing) {
    return res.status(404).json({ error: '发布单不存在' });
  }
  
  dbModule.run(
    'UPDATE releases SET name = ?, version = ?, status = ?, planned_date = ?, description = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    [
      name !== undefined ? name : existing.name,
      version !== undefined ? version : existing.version,
      status !== undefined ? status : existing.status,
      planned_date !== undefined ? planned_date : existing.planned_date,
      description !== undefined ? description : existing.description,
      id
    ]
  );
  
  const release = dbModule.query('SELECT * FROM releases WHERE id = ?', [id])[0];
  res.json({ data: release });
});

router.delete('/:id', (req, res) => {
  const { id } = req.params;
  
  const existing = dbModule.query('SELECT * FROM releases WHERE id = ?', [id])[0];
  if (!existing) {
    return res.status(404).json({ error: '发布单不存在' });
  }
  
  dbModule.run('DELETE FROM releases WHERE id = ?', [id]);
  res.json({ message: '删除成功' });
});

router.post('/:id/import-changes', (req, res) => {
  const { id } = req.params;
  const { changes } = req.body;
  
  if (!changes || !Array.isArray(changes) || changes.length === 0) {
    return res.status(400).json({ error: '变更列表不能为空' });
  }
  
  const release = dbModule.query('SELECT * FROM releases WHERE id = ?', [id])[0];
  if (!release) {
    return res.status(404).json({ error: '发布单不存在' });
  }
  
  const insertStmt = dbModule.prepare(`
    INSERT INTO changes 
    (release_id, file_path, change_type, module, service_id, repository_id, committer, risk_level, requirement_id, requirement_title, confirmed, description)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  
  const services = dbModule.query('SELECT * FROM services');
  const repos = dbModule.query('SELECT * FROM repositories');
  
  let successCount = 0;
  const errors = [];
  
  changes.forEach((change, index) => {
    try {
      let serviceId = change.service_id;
      if (!serviceId && change.service_name) {
        const svc = services.find(s => s.name === change.service_name);
        if (svc) serviceId = svc.id;
      }
      
      let repoId = change.repository_id;
      if (!repoId && change.repository_name) {
        const repo = repos.find(r => r.name === change.repository_name);
        if (repo) repoId = repo.id;
      }
      
      insertStmt.run(
        id,
        change.file_path || `unknown_${index}`,
        change.change_type || 'modify',
        change.module || null,
        serviceId || null,
        repoId || null,
        change.committer || null,
        change.risk_level || 'medium',
        change.requirement_id || null,
        change.requirement_title || null,
        change.confirmed ? 1 : 0,
        change.description || null
      );
      successCount++;
    } catch (err) {
      errors.push({ index, error: err.message });
    }
  });
  
  res.json({
    message: `导入完成，成功 ${successCount} 条，失败 ${errors.length} 条`,
    success_count: successCount,
    failed_count: errors.length,
    errors
  });
});

module.exports = router;
