const express = require('express');
const router = express.Router();
const impactAnalyzer = require('../services/impactAnalyzer');
const dbModule = require('../db');

router.get('/overview', (req, res) => {
  try {
    const stats = impactAnalyzer.getStatistics();
    res.json({ data: stats });
  } catch (err) {
    console.error('Error getting statistics:', err);
    res.status(500).json({ error: '获取统计数据失败: ' + err.message });
  }
});

router.get('/dashboard', (req, res) => {
  try {
    const stats = impactAnalyzer.getStatistics();
    
    const pendingChanges = dbModule.query(`
      SELECT c.*, s.name as service_name, rel.name as release_name
      FROM changes c
      LEFT JOIN services s ON c.service_id = s.id
      JOIN releases rel ON c.release_id = rel.id
      WHERE c.confirmed = 0 AND c.rejected = 0
      ORDER BY c.risk_level = 'high' DESC, c.created_at DESC
      LIMIT 10
    `);
    
    const highRiskChanges = dbModule.query(`
      SELECT c.*, s.name as service_name, rel.name as release_name
      FROM changes c
      LEFT JOIN services s ON c.service_id = s.id
      JOIN releases rel ON c.release_id = rel.id
      WHERE c.risk_level = 'high'
      ORDER BY c.confirmed ASC, c.rejected ASC, c.created_at DESC
      LIMIT 10
    `);
    
    const releasesWithRisk = dbModule.query(`
      SELECT r.*,
        (SELECT COUNT(*) FROM changes c WHERE c.release_id = r.id) as total_changes,
        (SELECT COUNT(*) FROM changes c WHERE c.release_id = r.id AND c.risk_level = 'high') as high_risk_count,
        (SELECT COUNT(*) FROM changes c WHERE c.release_id = r.id AND c.confirmed = 1) as confirmed_count,
        (SELECT COUNT(*) FROM changes c WHERE c.release_id = r.id AND c.rejected = 1) as rejected_count,
        (SELECT COUNT(*) FROM changes c WHERE c.release_id = r.id AND c.confirmed = 0 AND c.rejected = 0) as pending_count
      FROM releases r
      ORDER BY r.planned_date DESC, r.created_at DESC
    `);

    releasesWithRisk.forEach(r => {
      if (r.total_changes > 0) {
        r.confirm_rate = Math.round(r.confirmed_count / r.total_changes * 100);
        if (r.high_risk_count > 5 || (r.total_changes > 0 && r.high_risk_count / r.total_changes > 0.3)) {
          r.risk_score = 'high';
        } else if (r.high_risk_count > 0 || r.pending_count > r.total_changes * 0.5) {
          r.risk_score = 'medium';
        } else {
          r.risk_score = 'low';
        }
      } else {
        r.confirm_rate = 0;
        r.risk_score = 'low';
      }
    });
    
    const serviceChangeCounts = dbModule.query(`
      SELECT s.id, s.name, s.repository_id,
        COUNT(c.id) as change_count,
        SUM(CASE WHEN c.risk_level = 'high' THEN 1 ELSE 0 END) as high_risk_count,
        SUM(CASE WHEN c.confirmed = 1 THEN 1 ELSE 0 END) as confirmed_count,
        SUM(CASE WHEN c.rejected = 1 THEN 1 ELSE 0 END) as rejected_count,
        SUM(CASE WHEN c.confirmed = 0 AND c.rejected = 0 THEN 1 ELSE 0 END) as pending_count
      FROM services s
      LEFT JOIN changes c ON s.id = c.service_id
      GROUP BY s.id
      ORDER BY change_count DESC
    `);

    const rejectedChanges = dbModule.query(`
      SELECT c.*, s.name as service_name, rel.name as release_name
      FROM changes c
      LEFT JOIN services s ON c.service_id = s.id
      JOIN releases rel ON c.release_id = rel.id
      WHERE c.rejected = 1
      ORDER BY c.rejected_at DESC
      LIMIT 10
    `);

    const recentOperations = dbModule.query(`
      SELECT co.*, c.file_path, rel.name as release_name
      FROM change_operations co
      LEFT JOIN changes c ON co.change_id = c.id
      LEFT JOIN releases rel ON co.release_id = rel.id
      ORDER BY co.created_at DESC
      LIMIT 20
    `);

    const unlinkedReqChanges = dbModule.query(`
      SELECT c.*, s.name as service_name, rel.name as release_name
      FROM changes c
      LEFT JOIN services s ON c.service_id = s.id
      JOIN releases rel ON c.release_id = rel.id
      WHERE (c.requirement_id IS NULL OR c.requirement_id = '')
      ORDER BY c.created_at DESC
      LIMIT 10
    `);
    
    res.json({
      data: {
        overview: stats.overview,
        risk_distribution: stats.risk_distribution,
        release_status_distribution: stats.release_status_distribution,
        confirmation_distribution: stats.confirmation_distribution,
        top_services_by_changes: stats.top_services_by_changes,
        top_committers: stats.top_committers,
        recent_releases: stats.recent_releases,
        pending_changes: pendingChanges,
        high_risk_changes: highRiskChanges,
        rejected_changes: rejectedChanges,
        unlinked_requirement_changes: unlinkedReqChanges,
        releases: releasesWithRisk,
        service_change_counts: serviceChangeCounts,
        recent_operations: recentOperations
      }
    });
  } catch (err) {
    console.error('Error getting dashboard data:', err);
    res.status(500).json({ error: '获取看板数据失败: ' + err.message });
  }
});

router.get('/release-board', (req, res) => {
  try {
    const releases = dbModule.query(`
      SELECT r.*,
        (SELECT COUNT(*) FROM changes c WHERE c.release_id = r.id) as total_changes,
        (SELECT COUNT(*) FROM changes c WHERE c.release_id = r.id AND c.risk_level = 'high') as high_risk_count,
        (SELECT COUNT(*) FROM changes c WHERE c.release_id = r.id AND c.risk_level = 'medium') as medium_risk_count,
        (SELECT COUNT(*) FROM changes c WHERE c.release_id = r.id AND c.risk_level = 'low') as low_risk_count,
        (SELECT COUNT(*) FROM changes c WHERE c.release_id = r.id AND c.confirmed = 1) as confirmed_count,
        (SELECT COUNT(*) FROM changes c WHERE c.release_id = r.id AND c.rejected = 1) as rejected_count,
        (SELECT COUNT(*) FROM changes c WHERE c.release_id = r.id AND (c.requirement_id IS NULL OR c.requirement_id = '')) as unlinked_req_count
      FROM releases r
      ORDER BY r.status = 'pending' DESC, r.planned_date DESC, r.created_at DESC
    `);

    releases.forEach(r => {
      r.pending_count = r.total_changes - r.confirmed_count - r.rejected_count;
      if (r.total_changes > 0) {
        r.confirm_rate = Math.round(r.confirmed_count / r.total_changes * 100);
      } else {
        r.confirm_rate = 0;
      }
    });
    
    const todo = releases.filter(r => r.status === 'pending');
    const inProgress = releases.filter(r => r.status === 'testing' || r.status === 'staging');
    const done = releases.filter(r => r.status === 'released');
    
    res.json({
      data: {
        todo,
        in_progress: inProgress,
        done,
        all: releases
      }
    });
  } catch (err) {
    console.error('Error getting release board:', err);
    res.status(500).json({ error: '获取发布看板失败: ' + err.message });
  }
});

router.get('/releases-filter-options', (req, res) => {
  try {
    const repositories = dbModule.query('SELECT id, name FROM repositories ORDER BY name');
    const services = dbModule.query('SELECT id, name FROM services ORDER BY name');
    const committers = dbModule.query(`
      SELECT DISTINCT committer FROM changes 
      WHERE committer IS NOT NULL AND committer != '' 
      ORDER BY committer
    `);
    const owners = dbModule.query(`
      SELECT DISTINCT COALESCE(NULLIF(owner, ''), committer) as name 
      FROM changes 
      WHERE (owner IS NOT NULL AND owner != '') OR (committer IS NOT NULL AND committer != '')
      ORDER BY name
    `);
    
    res.json({
      data: {
        risk_levels: [
          { value: 'high', label: '高风险' },
          { value: 'medium', label: '中风险' },
          { value: 'low', label: '低风险' }
        ],
        change_types: [
          { value: 'add', label: '新增' },
          { value: 'modify', label: '修改' },
          { value: 'delete', label: '删除' }
        ],
        confirm_statuses: [
          { value: 'pending', label: '待确认' },
          { value: 'confirmed', label: '已确认' },
          { value: 'rejected', label: '已退回' }
        ],
        repositories,
        services,
        committers: committers.map(c => c.committer),
        owners: owners.map(o => o.name).filter((v, i, a) => a.indexOf(v) === i)
      }
    });
  } catch (err) {
    console.error('Error getting filter options:', err);
    res.status(500).json({ error: '获取筛选选项失败: ' + err.message });
  }
});

module.exports = router;
