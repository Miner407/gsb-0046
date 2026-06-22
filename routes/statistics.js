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
      WHERE c.confirmed = 0
      ORDER BY c.risk_level = 'high' DESC, c.created_at DESC
      LIMIT 10
    `);
    
    const highRiskChanges = dbModule.query(`
      SELECT c.*, s.name as service_name, rel.name as release_name
      FROM changes c
      LEFT JOIN services s ON c.service_id = s.id
      JOIN releases rel ON c.release_id = rel.id
      WHERE c.risk_level = 'high'
      ORDER BY c.confirmed ASC, c.created_at DESC
      LIMIT 10
    `);
    
    const releasesWithRisk = dbModule.query(`
      SELECT r.*,
        (SELECT COUNT(*) FROM changes c WHERE c.release_id = r.id) as total_changes,
        (SELECT COUNT(*) FROM changes c WHERE c.release_id = r.id AND c.risk_level = 'high') as high_risk_count,
        (SELECT COUNT(*) FROM changes c WHERE c.release_id = r.id AND c.confirmed = 1) as confirmed_count
      FROM releases r
      ORDER BY r.planned_date DESC, r.created_at DESC
    `);
    
    const serviceChangeCounts = dbModule.query(`
      SELECT s.id, s.name, s.repository_id,
        COUNT(c.id) as change_count,
        SUM(CASE WHEN c.risk_level = 'high' THEN 1 ELSE 0 END) as high_risk_count,
        SUM(CASE WHEN c.confirmed = 1 THEN 1 ELSE 0 END) as confirmed_count
      FROM services s
      LEFT JOIN changes c ON s.id = c.service_id
      GROUP BY s.id
      ORDER BY change_count DESC
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
        releases: releasesWithRisk,
        service_change_counts: serviceChangeCounts
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
        (SELECT COUNT(*) FROM changes c WHERE c.release_id = r.id AND c.requirement_id IS NULL OR c.requirement_id = '') as unlinked_req_count
      FROM releases r
      ORDER BY r.status = 'pending' DESC, r.planned_date DESC, r.created_at DESC
    `);
    
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

module.exports = router;
