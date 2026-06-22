const dbModule = require('../db');

const RISK_WEIGHTS = {
  risk_level: {
    high: 25,
    medium: 12,
    low: 3
  },
  cross_service: 15,
  db_table: 15,
  missing_requirement: 10,
  public_api: 8,
  unconfirmed: 5
};

function getReleaseChanges(releaseId) {
  const stmt = dbModule.prepare(`
    SELECT c.*, s.name as service_name, r.name as repository_name
    FROM changes c
    LEFT JOIN services s ON c.service_id = s.id
    LEFT JOIN repositories r ON c.repository_id = r.id
    WHERE c.release_id = ?
    ORDER BY c.created_at DESC
  `);
  return stmt.all(releaseId);
}

function getServiceDependencies() {
  const stmt = dbModule.prepare(`
    SELECT sd.*, s1.name as from_service_name, s2.name as to_service_name
    FROM service_dependencies sd
    JOIN services s1 ON sd.from_service_id = s1.id
    JOIN services s2 ON sd.to_service_id = s2.id
  `);
  return stmt.all();
}

function getTableReferences() {
  const stmt = dbModule.prepare(`
    SELECT tr.*, s.name as service_name, t.name as table_name, t.database_name
    FROM table_references tr
    JOIN services s ON tr.service_id = s.id
    JOIN db_tables t ON tr.table_id = t.id
  `);
  return stmt.all();
}

function getAllServices() {
  const stmt = dbModule.prepare('SELECT * FROM services');
  return stmt.all();
}

function getAllDbTables() {
  const stmt = dbModule.prepare('SELECT * FROM db_tables');
  return stmt.all();
}

function getAllApis() {
  const stmt = dbModule.prepare('SELECT * FROM apis');
  return stmt.all();
}

function calculateChangeRiskScore(change, crossServiceImpacted, dbImpactedTables, allApis) {
  const reasons = [];
  const suggestions = [];
  let score = 0;

  const riskWeight = RISK_WEIGHTS.risk_level[change.risk_level] || 0;
  if (riskWeight > 0) {
    score += riskWeight;
    const riskText = change.risk_level === 'high' ? '高风险' : change.risk_level === 'medium' ? '中风险' : '低风险';
    reasons.push(`风险等级为${riskText} (+${riskWeight}分)`);
  }

  const serviceHasCrossImpact = change.service_id && crossServiceImpacted.has(change.service_id);
  if (serviceHasCrossImpact) {
    score += RISK_WEIGHTS.cross_service;
    reasons.push(`变更服务存在跨服务依赖影响 (+${RISK_WEIGHTS.cross_service}分)`);
    suggestions.push('建议联动测试受影响的下游服务');
  }

  const isDbChange = change.module === 'db' || 
    change.file_path.includes('.sql') || 
    (change.service_id && dbImpactedTables.some(t => 
      (t.service_id === change.service_id && t.is_direct_change) ||
      change.file_path.includes(t.name)
    ));
  if (isDbChange) {
    score += RISK_WEIGHTS.db_table;
    reasons.push(`涉及数据库表结构或数据变更 (+${RISK_WEIGHTS.db_table}分)`);
    suggestions.push('建议执行数据库回滚预案验证');
    suggestions.push('建议在预发布环境进行数据迁移演练');
  }

  if (!change.requirement_id || change.requirement_id.trim() === '') {
    score += RISK_WEIGHTS.missing_requirement;
    reasons.push(`缺少关联需求ID (+${RISK_WEIGHTS.missing_requirement}分)`);
    suggestions.push('请补充关联需求编号和需求标题');
  }

  const serviceApis = allApis.filter(a => a.service_id === change.service_id);
  const isPublicApiChange = serviceApis.some(api => 
    change.file_path.includes(api.path) || 
    change.description?.includes(api.name)
  );
  if (isPublicApiChange || serviceApis.length > 0 && (change.module === 'api' || change.module?.includes('controller'))) {
    score += RISK_WEIGHTS.public_api;
    reasons.push(`可能影响公共API接口 (+${RISK_WEIGHTS.public_api}分)`);
    suggestions.push('建议进行API兼容性测试');
    suggestions.push('建议更新API文档');
  }

  if (!change.confirmed) {
    score += RISK_WEIGHTS.unconfirmed;
    reasons.push(`变更尚未确认 (+${RISK_WEIGHTS.unconfirmed}分)`);
    suggestions.push('请相关负责人确认变更影响');
  }

  const normalizedScore = Math.min(Math.round((score / 78) * 100), 100);
  
  let riskGrade;
  if (normalizedScore >= 70) riskGrade = 'high';
  else if (normalizedScore >= 40) riskGrade = 'medium';
  else riskGrade = 'low';

  if (change.risk_level === 'high' && suggestions.length === 0) {
    suggestions.push('高风险变更需重点关注验收');
  }
  if (suggestions.length === 0) {
    suggestions.push('建议按常规流程进行回归测试');
  }

  return {
    score,
    normalized_score: normalizedScore,
    risk_grade: riskGrade,
    reasons,
    suggestions
  };
}

function calculateBatchRiskScore(releaseId, changes, analysis) {
  const deps = getServiceDependencies();
  const tableRefs = getTableReferences();
  const tables = getAllDbTables();
  const allApis = getAllApis();

  const changedServiceIds = new Set();
  changes.forEach(c => {
    if (c.service_id) changedServiceIds.add(c.service_id);
  });

  const crossServiceImpacted = new Set();
  deps.forEach(dep => {
    if (changedServiceIds.has(dep.from_service_id)) {
      crossServiceImpacted.add(dep.to_service_id);
    }
    if (changedServiceIds.has(dep.to_service_id)) {
      crossServiceImpacted.add(dep.from_service_id);
    }
  });

  const dbImpactedTables = [];
  const changedTableIds = new Set();
  changes.forEach(change => {
    tables.forEach(table => {
      if (change.file_path.includes(table.name) || 
          change.description?.includes(table.name) ||
          (change.service_id === table.service_id && (change.module === 'db' || change.file_path.includes('.sql')))) {
        changedTableIds.add(table.id);
        dbImpactedTables.push({ ...table, is_direct_change: true });
      }
    });
  });
  tableRefs.forEach(ref => {
    if (changedTableIds.has(ref.table_id)) {
      dbImpactedTables.push({ id: ref.table_id, name: ref.table_name, service_id: ref.service_id, is_direct_change: false });
    }
  });

  const totalRawScore = changes.reduce((sum, change) => {
    const riskInfo = calculateChangeRiskScore(change, crossServiceImpacted, dbImpactedTables, allApis);
    return sum + riskInfo.score;
  }, 0);

  const avgScore = changes.length > 0 ? totalRawScore / changes.length : 0;
  const normalizedBatchScore = Math.min(Math.round((avgScore / 78) * 100), 100);

  const batchReasons = [];
  const batchSuggestions = [];

  const highRiskCount = analysis.risk_assessment.high_risk_count;
  const dbChangeCount = analysis.risk_assessment.db_changes_count;
  const crossServiceCount = analysis.risk_assessment.cross_service_impact_count;
  const unlinkedCount = analysis.risk_assessment.unlinked_requirements_count;
  const unconfirmedCount = changes.filter(c => !c.confirmed).length;
  const publicApiCount = changes.filter(c => 
    c.module === 'api' || c.module?.includes('controller') || c.file_path?.includes('Controller')
  ).length;

  if (highRiskCount > 0) {
    batchReasons.push(`包含 ${highRiskCount} 个高风险变更`);
  }
  if (crossServiceCount > 0) {
    batchReasons.push(`存在跨服务影响，涉及 ${crossServiceCount} 个服务`);
    batchSuggestions.push('建议组织跨团队联调测试');
  }
  if (dbChangeCount > 0) {
    batchReasons.push(`涉及 ${dbChangeCount} 处数据库变更`);
    batchSuggestions.push('建议DBA审核SQL脚本');
  }
  if (unlinkedCount > 0) {
    batchReasons.push(`有 ${unlinkedCount} 个变更未关联需求`);
    batchSuggestions.push('请补充需求关联以便溯源');
  }
  if (unconfirmedCount > 0) {
    batchReasons.push(`尚有 ${unconfirmedCount} 个变更待确认`);
    batchSuggestions.push('请尽快完成变更确认流程');
  }
  if (publicApiCount > 0) {
    batchReasons.push(`可能影响 ${publicApiCount} 处公共接口`);
    batchSuggestions.push('建议安排API兼容性专项测试');
  }

  if (batchSuggestions.length === 0) {
    batchSuggestions.push('本次发布整体风险较低，按常规流程验收即可');
  }

  let overallRisk;
  if (normalizedBatchScore >= 70) overallRisk = 'high';
  else if (normalizedBatchScore >= 40) overallRisk = 'medium';
  else overallRisk = 'low';

  const scoreDetails = {
    raw_score_total: totalRawScore,
    avg_raw_score: Math.round(avgScore * 100) / 100,
    normalized_score: normalizedBatchScore,
    overall_risk: overallRisk,
    high_risk_count: highRiskCount,
    db_change_count: dbChangeCount,
    cross_service_count: crossServiceCount,
    unlinked_requirements_count: unlinkedCount,
    unconfirmed_count: unconfirmedCount,
    public_api_impact_count: publicApiCount,
    change_risk_scores: changes.map(change => {
      const riskInfo = calculateChangeRiskScore(change, crossServiceImpacted, dbImpactedTables, allApis);
      return {
        change_id: change.id,
        file_path: change.file_path,
        service_name: change.service_name,
        risk_level: change.risk_level,
        score: riskInfo.score,
        normalized_score: riskInfo.normalized_score,
        risk_grade: riskInfo.risk_grade,
        reasons: riskInfo.reasons,
        suggestions: riskInfo.suggestions
      };
    }).sort((a, b) => b.normalized_score - a.normalized_score)
  };

  return {
    score: normalizedBatchScore,
    overall_risk: overallRisk,
    score_details: scoreDetails,
    risk_reasons: batchReasons,
    suggestions: batchSuggestions
  };
}

function analyzeImpact(releaseId) {
  const changes = getReleaseChanges(releaseId);
  const deps = getServiceDependencies();
  const tableRefs = getTableReferences();
  const services = getAllServices();
  const tables = getAllDbTables();

  const changedServiceIds = new Set();
  const changedRepoIds = new Set();
  const changedModules = new Set();
  const dbChanges = [];
  const unlinkedRequirements = [];
  const highRiskChanges = [];
  const committers = new Set();

  changes.forEach(change => {
    if (change.service_id) changedServiceIds.add(change.service_id);
    if (change.repository_id) changedRepoIds.add(change.repository_id);
    if (change.module) changedModules.add(change.module);
    if (change.committer) committers.add(change.committer);
    
    if (change.module === 'db' || change.file_path.includes('.sql')) {
      dbChanges.push(change);
    }
    
    if (!change.requirement_id || change.requirement_id.trim() === '') {
      unlinkedRequirements.push(change);
    }
    
    if (change.risk_level === 'high') {
      highRiskChanges.push(change);
    }
  });

  const impactedServices = new Set(changedServiceIds);
  const impactedBy = {};
  
  changedServiceIds.forEach(serviceId => {
    impactedBy[serviceId] = ['direct'];
  });

  function addImpactedService(serviceId, reason, sourceServiceId) {
    if (!impactedServices.has(serviceId)) {
      impactedServices.add(serviceId);
      impactedBy[serviceId] = [reason];
      return true;
    }
    if (!impactedBy[serviceId].includes(reason)) {
      impactedBy[serviceId].push(reason);
    }
    return false;
  }

  deps.forEach(dep => {
    if (changedServiceIds.has(dep.from_service_id)) {
      addImpactedService(dep.to_service_id, 'upstream_dependency', dep.from_service_id);
    }
    if (changedServiceIds.has(dep.to_service_id)) {
      addImpactedService(dep.from_service_id, 'downstream_dependency', dep.to_service_id);
    }
  });

  const changedTableIds = new Set();
  dbChanges.forEach(change => {
    tables.forEach(table => {
      if (change.file_path.includes(table.name) || 
          change.description?.includes(table.name) ||
          (change.service_id === table.service_id && change.module === 'db')) {
        changedTableIds.add(table.id);
      }
    });
  });

  const dbImpactedServices = new Set();
  tableRefs.forEach(ref => {
    if (changedTableIds.has(ref.table_id)) {
      dbImpactedServices.add(ref.service_id);
      addImpactedService(ref.service_id, 'table_reference', ref.table_id);
    }
  });

  const allDbTablesImpacted = new Set();
  tableRefs.forEach(ref => {
    if (impactedServices.has(ref.service_id)) {
      allDbTablesImpacted.add(ref.table_id);
    }
  });
  changedTableIds.forEach(id => allDbTablesImpacted.add(id));

  const crossServiceImpact = [];
  impactedServices.forEach(serviceId => {
    if (!changedServiceIds.has(serviceId)) {
      const service = services.find(s => s.id === serviceId);
      crossServiceImpact.push({
        service_id: serviceId,
        service_name: service ? service.name : 'unknown',
        impact_reasons: impactedBy[serviceId] || []
      });
    }
  });

  const impactedServiceList = Array.from(impactedServices).map(id => {
    const service = services.find(s => s.id === id);
    return {
      id,
      name: service ? service.name : 'unknown',
      description: service ? service.description : '',
      is_direct_change: changedServiceIds.has(id),
      impact_reasons: impactedBy[id] || []
    };
  });

  const impactedTableList = Array.from(allDbTablesImpacted).map(id => {
    const table = tables.find(t => t.id === id);
    return {
      id,
      name: table ? table.name : 'unknown',
      database_name: table ? table.database_name : 'unknown',
      is_direct_change: changedTableIds.has(id)
    };
  });

  const riskAssessment = {
    high_risk_count: highRiskChanges.length,
    medium_risk_count: changes.filter(c => c.risk_level === 'medium').length,
    low_risk_count: changes.filter(c => c.risk_level === 'low').length,
    unlinked_requirements_count: unlinkedRequirements.length,
    db_changes_count: dbChanges.length,
    cross_service_impact_count: crossServiceImpact.length,
    total_services_impacted: impactedServices.size,
    total_tables_impacted: allDbTablesImpacted.size,
    committers_count: committers.size,
    overall_risk: calculateOverallRisk(highRiskChanges.length, changes.length, crossServiceImpact.length, dbChanges.length)
  };

  const riskScore = calculateBatchRiskScore(releaseId, changes, { risk_assessment: riskAssessment });

  return {
    release_id: releaseId,
    total_changes: changes.length,
    direct_changed_services: Array.from(changedServiceIds),
    impacted_services: impactedServiceList,
    impacted_tables: impactedTableList,
    cross_service_impact: crossServiceImpact,
    db_changes: dbChanges,
    unlinked_requirements: unlinkedRequirements,
    high_risk_changes: highRiskChanges,
    risk_assessment: riskAssessment,
    risk_score: riskScore,
    changed_modules: Array.from(changedModules),
    committers: Array.from(committers)
  };
}

function calculateOverallRisk(highCount, totalCount, crossServiceCount, dbCount) {
  let score = 0;
  if (totalCount > 0) {
    score += (highCount / totalCount) * 40;
  }
  score += Math.min(crossServiceCount * 5, 25);
  score += Math.min(dbCount * 4, 20);
  if (totalCount > 20) score += 15;
  else if (totalCount > 10) score += 10;
  else if (totalCount > 5) score += 5;

  if (score >= 70) return 'high';
  if (score >= 40) return 'medium';
  return 'low';
}

function buildImpactTopology(releaseId) {
  const analysis = analyzeImpact(releaseId);
  const deps = getServiceDependencies();
  
  const nodes = analysis.impacted_services.map(s => ({
    id: s.id,
    name: s.name,
    type: s.is_direct_change ? 'changed' : 'impacted',
    risk_level: s.is_direct_change ? getServiceRiskLevel(s.id, releaseId) : 'low',
    impact_reasons: s.impact_reasons
  }));

  const nodeIds = new Set(nodes.map(n => n.id));
  const edges = deps
    .filter(d => nodeIds.has(d.from_service_id) && nodeIds.has(d.to_service_id))
    .map(d => ({
      from: d.from_service_id,
      to: d.to_service_id,
      type: d.dependency_type,
      description: d.description
    }));

  return {
    nodes,
    edges,
    analysis
  };
}

function getServiceRiskLevel(serviceId, releaseId) {
  const stmt = dbModule.prepare(`
    SELECT risk_level, COUNT(*) as count
    FROM changes
    WHERE release_id = ? AND service_id = ?
    GROUP BY risk_level
  `);
  const risks = stmt.all(releaseId, serviceId);
  
  if (risks.some(r => r.risk_level === 'high')) return 'high';
  if (risks.some(r => r.risk_level === 'medium')) return 'medium';
  return 'low';
}

function getConfirmationProgress(releaseId) {
  const changes = dbModule.query(`
    SELECT c.*, s.name as service_name
    FROM changes c
    LEFT JOIN services s ON c.service_id = s.id
    WHERE c.release_id = ?
  `, [releaseId]);

  const total = changes.length;
  const confirmed = changes.filter(c => c.confirmed === 1).length;
  const rejected = changes.filter(c => c.rejected === 1).length;
  const pending = total - confirmed - rejected;

  const ownerDist = {};
  changes.forEach(c => {
    const owner = c.owner || c.committer || '未分配';
    if (!ownerDist[owner]) {
      ownerDist[owner] = { total: 0, confirmed: 0, rejected: 0, pending: 0 };
    }
    ownerDist[owner].total++;
    if (c.confirmed === 1) ownerDist[owner].confirmed++;
    else if (c.rejected === 1) ownerDist[owner].rejected++;
    else ownerDist[owner].pending++;
  });

  const serviceDist = {};
  changes.forEach(c => {
    const svc = c.service_name || '未分类';
    if (!serviceDist[svc]) {
      serviceDist[svc] = { total: 0, confirmed: 0, rejected: 0, pending: 0 };
    }
    serviceDist[svc].total++;
    if (c.confirmed === 1) serviceDist[svc].confirmed++;
    else if (c.rejected === 1) serviceDist[svc].rejected++;
    else serviceDist[svc].pending++;
  });

  const confirmRate = total > 0 ? Math.round(confirmed / total * 100) : 0;

  return {
    release_id: releaseId,
    total,
    confirmed,
    rejected,
    pending,
    confirm_rate: confirmRate,
    owner_distribution: ownerDist,
    service_distribution: serviceDist
  };
}

function getStatistics() {
  const totalReleases = dbModule.query('SELECT COUNT(*) as count FROM releases')[0].count;
  const totalChanges = dbModule.query('SELECT COUNT(*) as count FROM changes')[0].count;
  const totalServices = dbModule.query('SELECT COUNT(*) as count FROM services')[0].count;
  const totalRepos = dbModule.query('SELECT COUNT(*) as count FROM repositories')[0].count;
  
  const riskCounts = dbModule.query(`
    SELECT risk_level, COUNT(*) as count 
    FROM changes 
    GROUP BY risk_level
  `);
  
  const statusCounts = dbModule.query(`
    SELECT status, COUNT(*) as count 
    FROM releases 
    GROUP BY status
  `);

  const confirmedCounts = dbModule.query(`
    SELECT confirmed, rejected, COUNT(*) as count 
    FROM changes 
    GROUP BY confirmed, rejected
  `);

  const topServicesByChanges = dbModule.query(`
    SELECT s.name, COUNT(c.id) as change_count
    FROM changes c
    JOIN services s ON c.service_id = s.id
    GROUP BY c.service_id
    ORDER BY change_count DESC
    LIMIT 5
  `);

  const topCommitters = dbModule.query(`
    SELECT committer, COUNT(*) as change_count
    FROM changes
    WHERE committer IS NOT NULL AND committer != ''
    GROUP BY committer
    ORDER BY change_count DESC
    LIMIT 5
  `);

  const recentReleases = dbModule.query(`
    SELECT r.*, 
      (SELECT COUNT(*) FROM changes c WHERE c.release_id = r.id) as change_count
    FROM releases r
    ORDER BY r.created_at DESC
    LIMIT 5
  `);

  return {
    overview: {
      total_releases: totalReleases,
      total_changes: totalChanges,
      total_services: totalServices,
      total_repositories: totalRepos
    },
    risk_distribution: riskCounts,
    release_status_distribution: statusCounts,
    confirmation_distribution: confirmedCounts,
    top_services_by_changes: topServicesByChanges,
    top_committers: topCommitters,
    recent_releases: recentReleases
  };
}

module.exports = {
  analyzeImpact,
  buildImpactTopology,
  getStatistics,
  getConfirmationProgress,
  getReleaseChanges,
  getServiceDependencies,
  getTableReferences,
  calculateChangeRiskScore,
  calculateBatchRiskScore
};
