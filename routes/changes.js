const express = require('express');
const router = express.Router();
const dbModule = require('../db');

router.get('/', (req, res) => {
  const { release_id, service_id, repository_id, risk_level, change_type, confirmed, requirement_id, keyword } = req.query;
  
  let sql = `
    SELECT c.*, 
      s.name as service_name,
      r.name as repository_name,
      rel.name as release_name
    FROM changes c
    LEFT JOIN services s ON c.service_id = s.id
    LEFT JOIN repositories r ON c.repository_id = r.id
    LEFT JOIN releases rel ON c.release_id = rel.id
    WHERE 1=1
  `;
  const params = [];
  
  if (release_id) {
    sql += ' AND c.release_id = ?';
    params.push(release_id);
  }
  
  if (service_id) {
    sql += ' AND c.service_id = ?';
    params.push(service_id);
  }
  
  if (repository_id) {
    sql += ' AND c.repository_id = ?';
    params.push(repository_id);
  }
  
  if (risk_level) {
    sql += ' AND c.risk_level = ?';
    params.push(risk_level);
  }
  
  if (change_type) {
    sql += ' AND c.change_type = ?';
    params.push(change_type);
  }
  
  if (confirmed !== undefined && confirmed !== '') {
    sql += ' AND c.confirmed = ?';
    params.push(confirmed === 'true' || confirmed === '1' ? 1 : 0);
  }
  
  if (requirement_id) {
    sql += ' AND c.requirement_id = ?';
    params.push(requirement_id);
  }
  
  if (keyword) {
    sql += ' AND (c.file_path LIKE ? OR c.description LIKE ? OR c.committer LIKE ?)';
    params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
  }
  
  sql += ' ORDER BY c.created_at DESC';
  
  const changes = dbModule.query(sql, params);
  res.json({ data: changes });
});

router.get('/pending', (req, res) => {
  const changes = dbModule.query(`
    SELECT c.*, 
      s.name as service_name,
      r.name as repository_name,
      rel.name as release_name
    FROM changes c
    LEFT JOIN services s ON c.service_id = s.id
    LEFT JOIN repositories r ON c.repository_id = r.id
    LEFT JOIN releases rel ON c.release_id = rel.id
    WHERE c.confirmed = 0
    ORDER BY c.risk_level = 'high' DESC, c.created_at DESC
  `);
  res.json({ data: changes });
});

router.get('/high-risk', (req, res) => {
  const changes = dbModule.query(`
    SELECT c.*, 
      s.name as service_name,
      r.name as repository_name,
      rel.name as release_name
    FROM changes c
    LEFT JOIN services s ON c.service_id = s.id
    LEFT JOIN repositories r ON c.repository_id = r.id
    LEFT JOIN releases rel ON c.release_id = rel.id
    WHERE c.risk_level = 'high'
    ORDER BY c.confirmed ASC, c.created_at DESC
  `);
  res.json({ data: changes });
});

router.get('/unlinked-requirements', (req, res) => {
  const changes = dbModule.query(`
    SELECT c.*, 
      s.name as service_name,
      r.name as repository_name,
      rel.name as release_name
    FROM changes c
    LEFT JOIN services s ON c.service_id = s.id
    LEFT JOIN repositories r ON c.repository_id = r.id
    LEFT JOIN releases rel ON c.release_id = rel.id
    WHERE c.requirement_id IS NULL OR c.requirement_id = ''
    ORDER BY c.created_at DESC
  `);
  res.json({ data: changes });
});

router.get('/:id', (req, res) => {
  const { id } = req.params;
  const change = dbModule.query(`
    SELECT c.*, 
      s.name as service_name,
      r.name as repository_name,
      rel.name as release_name
    FROM changes c
    LEFT JOIN services s ON c.service_id = s.id
    LEFT JOIN repositories r ON c.repository_id = r.id
    LEFT JOIN releases rel ON c.release_id = rel.id
    WHERE c.id = ?
  `, [id])[0];
  
  if (!change) {
    return res.status(404).json({ error: '变更不存在' });
  }
  
  res.json({ data: change });
});

router.post('/', (req, res) => {
  const { 
    release_id, file_path, change_type = 'modify', module, 
    service_id, repository_id, committer, risk_level = 'medium',
    requirement_id, requirement_title, confirmed = 0, description 
  } = req.body;
  
  if (!release_id || !file_path) {
    return res.status(400).json({ error: '发布单ID和文件路径不能为空' });
  }
  
  const info = dbModule.run(`
    INSERT INTO changes 
    (release_id, file_path, change_type, module, service_id, repository_id, committer, risk_level, requirement_id, requirement_title, confirmed, description)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    release_id, file_path, change_type, module || null, 
    service_id || null, repository_id || null, committer || null, 
    risk_level, requirement_id || null, requirement_title || null, 
    confirmed ? 1 : 0, description || null
  ]);
  
  const change = dbModule.query('SELECT * FROM changes WHERE id = ?', [info.lastInsertRowid])[0];
  res.json({ data: change });
});

router.put('/:id', (req, res) => {
  const { id } = req.params;
  const { 
    file_path, change_type, module, service_id, repository_id,
    committer, risk_level, requirement_id, requirement_title, description 
  } = req.body;
  
  const existing = dbModule.query('SELECT * FROM changes WHERE id = ?', [id])[0];
  if (!existing) {
    return res.status(404).json({ error: '变更不存在' });
  }
  
  dbModule.run(`
    UPDATE changes SET 
      file_path = ?, change_type = ?, module = ?, service_id = ?, 
      repository_id = ?, committer = ?, risk_level = ?, requirement_id = ?,
      requirement_title = ?, description = ?
    WHERE id = ?
  `, [
    file_path !== undefined ? file_path : existing.file_path,
    change_type !== undefined ? change_type : existing.change_type,
    module !== undefined ? module : existing.module,
    service_id !== undefined ? service_id : existing.service_id,
    repository_id !== undefined ? repository_id : existing.repository_id,
    committer !== undefined ? committer : existing.committer,
    risk_level !== undefined ? risk_level : existing.risk_level,
    requirement_id !== undefined ? requirement_id : existing.requirement_id,
    requirement_title !== undefined ? requirement_title : existing.requirement_title,
    description !== undefined ? description : existing.description,
    id
  ]);
  
  const change = dbModule.query('SELECT * FROM changes WHERE id = ?', [id])[0];
  res.json({ data: change });
});

router.post('/:id/confirm', (req, res) => {
  const { id } = req.params;
  const { confirmed_by } = req.body;
  
  const existing = dbModule.query('SELECT * FROM changes WHERE id = ?', [id])[0];
  if (!existing) {
    return res.status(404).json({ error: '变更不存在' });
  }
  
  dbModule.run(`
    UPDATE changes SET confirmed = 1, confirmed_by = ?, confirmed_at = CURRENT_TIMESTAMP WHERE id = ?
  `, [confirmed_by || 'system', id]);
  
  const change = dbModule.query('SELECT * FROM changes WHERE id = ?', [id])[0];
  res.json({ data: change, message: '确认成功' });
});

router.post('/:id/unconfirm', (req, res) => {
  const { id } = req.params;
  
  const existing = dbModule.query('SELECT * FROM changes WHERE id = ?', [id])[0];
  if (!existing) {
    return res.status(404).json({ error: '变更不存在' });
  }
  
  dbModule.run('UPDATE changes SET confirmed = 0, confirmed_by = NULL, confirmed_at = NULL WHERE id = ?', [id]);
  
  const change = dbModule.query('SELECT * FROM changes WHERE id = ?', [id])[0];
  res.json({ data: change, message: '取消确认成功' });
});

router.delete('/:id', (req, res) => {
  const { id } = req.params;
  
  const existing = dbModule.query('SELECT * FROM changes WHERE id = ?', [id])[0];
  if (!existing) {
    return res.status(404).json({ error: '变更不存在' });
  }
  
  dbModule.run('DELETE FROM changes WHERE id = ?', [id]);
  res.json({ message: '删除成功' });
});

module.exports = router;
