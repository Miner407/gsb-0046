const express = require('express');
const router = express.Router();
const dbModule = require('../db');
const impactAnalyzer = require('../services/impactAnalyzer');

function logOperation(changeId, releaseId, operationType, operator, comment) {
  try {
    dbModule.run(
      'INSERT INTO change_operations (change_id, release_id, operation_type, operator, comment) VALUES (?, ?, ?, ?, ?)',
      [changeId, releaseId || null, operationType, operator || null, comment || null]
    );
  } catch (err) {
    console.warn('Failed to log operation:', err.message);
  }
}

router.get('/', (req, res) => {
  const { release_id, service_id, repository_id, risk_level, change_type, confirmed, rejected, requirement_id, owner, keyword } = req.query;
  
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
  
  if (rejected !== undefined && rejected !== '') {
    sql += ' AND c.rejected = ?';
    params.push(rejected === 'true' || rejected === '1' ? 1 : 0);
  }
  
  if (requirement_id) {
    sql += ' AND c.requirement_id = ?';
    params.push(requirement_id);
  }
  
  if (owner) {
    sql += ' AND (c.owner = ? OR c.committer = ?)';
    params.push(owner, owner);
  }
  
  if (keyword) {
    sql += ' AND (c.file_path LIKE ? OR c.description LIKE ? OR c.committer LIKE ? OR c.owner LIKE ?)';
    params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
  }
  
  sql += ' ORDER BY c.risk_level = "high" DESC, c.confirmed ASC, c.created_at DESC';
  
  const changes = dbModule.query(sql, params);
  res.json({ data: changes });
});

router.get('/pending', (req, res) => {
  const { release_id, service_id, risk_level, owner } = req.query;
  
  let sql = `
    SELECT c.*, 
      s.name as service_name,
      r.name as repository_name,
      rel.name as release_name
    FROM changes c
    LEFT JOIN services s ON c.service_id = s.id
    LEFT JOIN repositories r ON c.repository_id = r.id
    LEFT JOIN releases rel ON c.release_id = rel.id
    WHERE c.confirmed = 0 AND c.rejected = 0
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
  if (risk_level) {
    sql += ' AND c.risk_level = ?';
    params.push(risk_level);
  }
  if (owner) {
    sql += ' AND (c.owner = ? OR c.committer = ?)';
    params.push(owner, owner);
  }
  
  sql += ' ORDER BY c.risk_level = "high" DESC, c.created_at DESC';
  
  const changes = dbModule.query(sql, params);
  res.json({ data: changes });
});

router.get('/rejected', (req, res) => {
  const changes = dbModule.query(`
    SELECT c.*, 
      s.name as service_name,
      r.name as repository_name,
      rel.name as release_name
    FROM changes c
    LEFT JOIN services s ON c.service_id = s.id
    LEFT JOIN repositories r ON c.repository_id = r.id
    LEFT JOIN releases rel ON c.release_id = rel.id
    WHERE c.rejected = 1
    ORDER BY c.rejected_at DESC
  `);
  res.json({ data: changes });
});

router.get('/high-risk', (req, res) => {
  const { status } = req.query;
  
  let sql = `
    SELECT c.*, 
      s.name as service_name,
      r.name as repository_name,
      rel.name as release_name
    FROM changes c
    LEFT JOIN services s ON c.service_id = s.id
    LEFT JOIN repositories r ON c.repository_id = r.id
    LEFT JOIN releases rel ON c.release_id = rel.id
    WHERE c.risk_level = 'high'
  `;
  const params = [];
  
  if (status === 'pending') {
    sql += ' AND c.confirmed = 0 AND c.rejected = 0';
  } else if (status === 'confirmed') {
    sql += ' AND c.confirmed = 1';
  } else if (status === 'rejected') {
    sql += ' AND c.rejected = 1';
  }
  
  sql += ' ORDER BY c.confirmed ASC, c.rejected ASC, c.created_at DESC';
  
  const changes = dbModule.query(sql, params);
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

router.get('/operations/:changeId', (req, res) => {
  const { changeId } = req.params;
  
  const operations = dbModule.query(`
    SELECT co.*,
      c.file_path,
      rel.name as release_name
    FROM change_operations co
    LEFT JOIN changes c ON co.change_id = c.id
    LEFT JOIN releases rel ON co.release_id = rel.id
    WHERE co.change_id = ?
    ORDER BY co.created_at DESC
  `, [changeId]);
  
  res.json({ data: operations });
});

router.get('/confirmation-progress/:releaseId', (req, res) => {
  try {
    const { releaseId } = req.params;
    const progress = impactAnalyzer.getConfirmationProgress(releaseId);
    
    const release = dbModule.query('SELECT * FROM releases WHERE id = ?', [releaseId])[0];
    if (release) {
      progress.release_name = release.name;
      progress.release_status = release.status;
    }
    
    res.json({ data: progress });
  } catch (err) {
    console.error('Error getting confirmation progress:', err);
    res.status(500).json({ error: '获取确认进度失败: ' + err.message });
  }
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
  
  const operations = dbModule.query(`
    SELECT * FROM change_operations 
    WHERE change_id = ? 
    ORDER BY created_at DESC
  `, [id]);
  
  res.json({ data: { ...change, operations } });
});

router.post('/', (req, res) => {
  const { 
    release_id, file_path, change_type = 'modify', module, 
    service_id, repository_id, committer, risk_level = 'medium',
    requirement_id, requirement_title, confirmed = 0, owner, description 
  } = req.body;
  
  if (!release_id || !file_path) {
    return res.status(400).json({ error: '发布单ID和文件路径不能为空' });
  }
  
  const info = dbModule.run(`
    INSERT INTO changes 
    (release_id, file_path, change_type, module, service_id, repository_id, committer, risk_level, requirement_id, requirement_title, confirmed, owner, description)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    release_id, file_path, change_type, module || null, 
    service_id || null, repository_id || null, committer || null, 
    risk_level, requirement_id || null, requirement_title || null, 
    confirmed ? 1 : 0, owner || null, description || null
  ]);
  
  const change = dbModule.query('SELECT * FROM changes WHERE id = ?', [info.lastInsertRowid])[0];
  
  if (confirmed) {
    logOperation(change.id, release_id, 'create_and_confirm', committer || 'system', description);
  } else {
    logOperation(change.id, release_id, 'create', committer || 'system', description);
  }
  
  res.json({ data: change });
});

router.put('/:id', (req, res) => {
  const { id } = req.params;
  const { 
    file_path, change_type, module, service_id, repository_id,
    committer, risk_level, requirement_id, requirement_title, 
    owner, description 
  } = req.body;
  
  const existing = dbModule.query('SELECT * FROM changes WHERE id = ?', [id])[0];
  if (!existing) {
    return res.status(404).json({ error: '变更不存在' });
  }
  
  dbModule.run(`
    UPDATE changes SET 
      file_path = ?, change_type = ?, module = ?, service_id = ?, 
      repository_id = ?, committer = ?, risk_level = ?, requirement_id = ?,
      requirement_title = ?, owner = ?, description = ?
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
    owner !== undefined ? owner : existing.owner,
    description !== undefined ? description : existing.description,
    id
  ]);
  
  logOperation(id, existing.release_id, 'update', committer || existing.committer || 'system', '更新变更信息');
  
  const change = dbModule.query('SELECT * FROM changes WHERE id = ?', [id])[0];
  res.json({ data: change });
});

router.post('/:id/confirm', (req, res) => {
  const { id } = req.params;
  const { confirmed_by, comment } = req.body;
  
  const existing = dbModule.query('SELECT * FROM changes WHERE id = ?', [id])[0];
  if (!existing) {
    return res.status(404).json({ error: '变更不存在' });
  }
  
  dbModule.run(`
    UPDATE changes SET 
      confirmed = 1, 
      confirmed_by = ?, 
      confirmed_at = CURRENT_TIMESTAMP,
      rejected = 0,
      rejected_by = NULL,
      rejected_at = NULL,
      reject_reason = NULL,
      owner = ?
    WHERE id = ?
  `, [confirmed_by || 'system', confirmed_by || existing.owner || existing.committer, id]);
  
  logOperation(id, existing.release_id, 'confirm', confirmed_by || 'system', comment || '确认变更影响通过');
  
  const change = dbModule.query('SELECT * FROM changes WHERE id = ?', [id])[0];
  res.json({ data: change, message: '确认成功' });
});

router.post('/:id/reject', (req, res) => {
  const { id } = req.params;
  const { rejected_by, reason, comment } = req.body;
  
  const existing = dbModule.query('SELECT * FROM changes WHERE id = ?', [id])[0];
  if (!existing) {
    return res.status(404).json({ error: '变更不存在' });
  }
  
  dbModule.run(`
    UPDATE changes SET 
      rejected = 1, 
      rejected_by = ?, 
      rejected_at = CURRENT_TIMESTAMP,
      reject_reason = ?,
      confirmed = 0,
      confirmed_by = NULL,
      confirmed_at = NULL
    WHERE id = ?
  `, [rejected_by || 'system', reason || null, id]);
  
  logOperation(id, existing.release_id, 'reject', rejected_by || 'system', comment || reason || '退回变更，需要重新处理');
  
  const change = dbModule.query('SELECT * FROM changes WHERE id = ?', [id])[0];
  res.json({ data: change, message: '退回成功' });
});

router.post('/:id/unconfirm', (req, res) => {
  const { id } = req.params;
  const { operator, comment } = req.body;
  
  const existing = dbModule.query('SELECT * FROM changes WHERE id = ?', [id])[0];
  if (!existing) {
    return res.status(404).json({ error: '变更不存在' });
  }
  
  dbModule.run('UPDATE changes SET confirmed = 0, confirmed_by = NULL, confirmed_at = NULL WHERE id = ?', [id]);
  
  logOperation(id, existing.release_id, 'unconfirm', operator || 'system', comment || '取消确认状态');
  
  const change = dbModule.query('SELECT * FROM changes WHERE id = ?', [id])[0];
  res.json({ data: change, message: '取消确认成功' });
});

router.post('/batch-confirm', (req, res) => {
  const { ids, confirmed_by, comment } = req.body;
  
  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: '变更ID列表不能为空' });
  }
  
  let successCount = 0;
  let failCount = 0;
  const errors = [];
  
  ids.forEach((id, index) => {
    try {
      const existing = dbModule.query('SELECT * FROM changes WHERE id = ?', [id])[0];
      if (!existing) {
        failCount++;
        errors.push({ id, error: '变更不存在' });
        return;
      }
      
      dbModule.run(`
        UPDATE changes SET 
          confirmed = 1, 
          confirmed_by = ?, 
          confirmed_at = CURRENT_TIMESTAMP,
          rejected = 0,
          rejected_by = NULL,
          rejected_at = NULL,
          reject_reason = NULL,
          owner = ?
        WHERE id = ?
      `, [confirmed_by || 'system', confirmed_by || existing.owner || existing.committer, id]);
      
      logOperation(id, existing.release_id, 'batch_confirm', confirmed_by || 'system', comment || '批量确认变更');
      successCount++;
    } catch (err) {
      failCount++;
      errors.push({ id, error: err.message, index });
    }
  });
  
  res.json({
    message: `批量确认完成，成功 ${successCount} 条，失败 ${failCount} 条`,
    success_count: successCount,
    failed_count: failCount,
    errors
  });
});

router.post('/batch-reject', (req, res) => {
  const { ids, rejected_by, reason, comment } = req.body;
  
  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: '变更ID列表不能为空' });
  }
  
  let successCount = 0;
  let failCount = 0;
  const errors = [];
  
  ids.forEach((id, index) => {
    try {
      const existing = dbModule.query('SELECT * FROM changes WHERE id = ?', [id])[0];
      if (!existing) {
        failCount++;
        errors.push({ id, error: '变更不存在' });
        return;
      }
      
      dbModule.run(`
        UPDATE changes SET 
          rejected = 1, 
          rejected_by = ?, 
          rejected_at = CURRENT_TIMESTAMP,
          reject_reason = ?,
          confirmed = 0,
          confirmed_by = NULL,
          confirmed_at = NULL
        WHERE id = ?
      `, [rejected_by || 'system', reason || null, id]);
      
      logOperation(id, existing.release_id, 'batch_reject', rejected_by || 'system', comment || reason || '批量退回变更');
      successCount++;
    } catch (err) {
      failCount++;
      errors.push({ id, error: err.message, index });
    }
  });
  
  res.json({
    message: `批量退回完成，成功 ${successCount} 条，失败 ${failCount} 条`,
    success_count: successCount,
    failed_count: failCount,
    errors
  });
});

router.post('/batch-reset', (req, res) => {
  const { ids, operator, comment } = req.body;
  
  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: '变更ID列表不能为空' });
  }
  
  let successCount = 0;
  let failCount = 0;
  const errors = [];
  
  ids.forEach((id, index) => {
    try {
      const existing = dbModule.query('SELECT * FROM changes WHERE id = ?', [id])[0];
      if (!existing) {
        failCount++;
        errors.push({ id, error: '变更不存在' });
        return;
      }
      
      dbModule.run(`
        UPDATE changes SET 
          confirmed = 0, 
          confirmed_by = NULL, 
          confirmed_at = NULL,
          rejected = 0,
          rejected_by = NULL,
          rejected_at = NULL,
          reject_reason = NULL
        WHERE id = ?
      `, [id]);
      
      logOperation(id, existing.release_id, 'batch_reset', operator || 'system', comment || '批量重置确认状态');
      successCount++;
    } catch (err) {
      failCount++;
      errors.push({ id, error: err.message, index });
    }
  });
  
  res.json({
    message: `批量重置完成，成功 ${successCount} 条，失败 ${failCount} 条`,
    success_count: successCount,
    failed_count: failCount,
    errors
  });
});

router.delete('/:id', (req, res) => {
  const { id } = req.params;
  
  const existing = dbModule.query('SELECT * FROM changes WHERE id = ?', [id])[0];
  if (!existing) {
    return res.status(404).json({ error: '变更不存在' });
  }
  
  logOperation(id, existing.release_id, 'delete', 'system', '删除变更记录');
  
  dbModule.run('DELETE FROM changes WHERE id = ?', [id]);
  res.json({ message: '删除成功' });
});

module.exports = router;
