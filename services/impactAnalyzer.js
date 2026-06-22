const dbModule = require('../db');

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
          change.description.includes(table.name) ||
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
    risk_level: s.is_direct_change ? getServiceRiskLevel(s.id, releaseId) : 'low'
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
    SELECT confirmed, COUNT(*) as count 
    FROM changes 
    GROUP BY confirmed
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
  getReleaseChanges,
  getServiceDependencies,
  getTableReferences
};
