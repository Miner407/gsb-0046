const express = require('express');
const router = express.Router();
const impactAnalyzer = require('../services/impactAnalyzer');

router.get('/release/:releaseId', (req, res) => {
  try {
    const { releaseId } = req.params;
    const result = impactAnalyzer.analyzeImpact(releaseId);
    res.json({ data: result });
  } catch (err) {
    console.error('Error analyzing impact:', err);
    res.status(500).json({ error: '分析失败: ' + err.message });
  }
});

router.get('/release/:releaseId/topology', (req, res) => {
  try {
    const { releaseId } = req.params;
    const result = impactAnalyzer.buildImpactTopology(releaseId);
    res.json({ data: result });
  } catch (err) {
    console.error('Error building topology:', err);
    res.status(500).json({ error: '构建拓扑失败: ' + err.message });
  }
});

router.get('/cross-service/:releaseId', (req, res) => {
  try {
    const { releaseId } = req.params;
    const result = impactAnalyzer.analyzeImpact(releaseId);
    res.json({ data: result.cross_service_impact });
  } catch (err) {
    console.error('Error getting cross-service impact:', err);
    res.status(500).json({ error: '获取跨服务影响失败: ' + err.message });
  }
});

router.get('/db-impact/:releaseId', (req, res) => {
  try {
    const { releaseId } = req.params;
    const result = impactAnalyzer.analyzeImpact(releaseId);
    res.json({ 
      data: {
        db_changes: result.db_changes,
        impacted_tables: result.impacted_tables
      }
    });
  } catch (err) {
    console.error('Error getting DB impact:', err);
    res.status(500).json({ error: '获取数据库影响失败: ' + err.message });
  }
});

router.get('/high-risk/:releaseId', (req, res) => {
  try {
    const { releaseId } = req.params;
    const result = impactAnalyzer.analyzeImpact(releaseId);
    res.json({ 
      data: {
        high_risk_changes: result.high_risk_changes,
        risk_assessment: result.risk_assessment
      }
    });
  } catch (err) {
    console.error('Error getting high-risk items:', err);
    res.status(500).json({ error: '获取高风险项失败: ' + err.message });
  }
});

router.get('/unlinked-requirements/:releaseId', (req, res) => {
  try {
    const { releaseId } = req.params;
    const result = impactAnalyzer.analyzeImpact(releaseId);
    res.json({ data: result.unlinked_requirements });
  } catch (err) {
    console.error('Error getting unlinked requirements:', err);
    res.status(500).json({ error: '获取未关联需求失败: ' + err.message });
  }
});

module.exports = router;
