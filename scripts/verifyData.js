const path = require('path');
const dbModule = require('../db');

const dbPath = path.join(__dirname, '..', 'data', 'app.db');

const REQUIREMENTS = {
  repositories: { min: 4, label: '仓库' },
  services: { min: 8, label: '服务' },
  changes: { min: 20, label: '变更' },
  releases: { min: 3, label: '发布单' },
  apis: { min: 10, label: 'API接口' },
  db_tables: { min: 8, label: '数据库表' },
  service_dependencies: { min: 8, label: '服务依赖' },
  api_calls: { min: 5, label: 'API调用' },
  table_references: { min: 5, label: '表引用' }
};

let errors = [];
let warnings = [];

function check() {
  console.log('='.repeat(60));
  console.log('多仓库发布变更影响分析平台 - 数据量验证');
  console.log('='.repeat(60));
  console.log(`数据库路径: ${dbPath}`);
  console.log('');

  console.log('1. 基础表数据量检查');
  console.log('-'.repeat(40));
  for (const [table, req] of Object.entries(REQUIREMENTS)) {
    const count = dbModule.query(`SELECT COUNT(*) as count FROM ${table}`)[0].count;
    const passed = count >= req.min;
    
    const status = passed ? '✅' : '❌';
    const message = `${status} ${req.label} (${table}): ${count} 条 (要求 >= ${req.min})`;
    console.log(message);
    
    if (!passed) {
      errors.push(`${req.label}数量不足: 实际 ${count} 条, 要求 >= ${req.min} 条`);
    }
  }
  console.log('');

  console.log('2. 关联关系完整性检查');
  console.log('-'.repeat(40));

  const serviceRepoCheck = dbModule.query(`
    SELECT COUNT(*) as count FROM services s 
    LEFT JOIN repositories r ON s.repository_id = r.id 
    WHERE r.id IS NULL
  `)[0].count;
  if (serviceRepoCheck === 0) {
    console.log('✅ 所有服务都有关联的仓库');
  } else {
    errors.push(`有 ${serviceRepoCheck} 个服务没有关联仓库`);
    console.log(`❌ 有 ${serviceRepoCheck} 个服务没有关联仓库`);
  }

  const changeReleaseCheck = dbModule.query(`
    SELECT COUNT(*) as count FROM changes c 
    LEFT JOIN releases r ON c.release_id = r.id 
    WHERE r.id IS NULL
  `)[0].count;
  if (changeReleaseCheck === 0) {
    console.log('✅ 所有变更都有关联的发布单');
  } else {
    errors.push(`有 ${changeReleaseCheck} 条变更没有关联发布单`);
    console.log(`❌ 有 ${changeReleaseCheck} 条变更没有关联发布单`);
  }

  const serviceDepFromCheck = dbModule.query(`
    SELECT COUNT(*) as count FROM service_dependencies sd 
    LEFT JOIN services s ON sd.from_service_id = s.id 
    WHERE s.id IS NULL
  `)[0].count;
  const serviceDepToCheck = dbModule.query(`
    SELECT COUNT(*) as count FROM service_dependencies sd 
    LEFT JOIN services s ON sd.to_service_id = s.id 
    WHERE s.id IS NULL
  `)[0].count;
  if (serviceDepFromCheck === 0 && serviceDepToCheck === 0) {
    console.log('✅ 所有服务依赖关系都完整');
  } else {
    errors.push(`服务依赖关系不完整: ${serviceDepFromCheck} 个源服务不存在, ${serviceDepToCheck} 个目标服务不存在`);
    console.log(`❌ 服务依赖关系不完整`);
  }
  console.log('');

  console.log('3. 数据分布检查');
  console.log('-'.repeat(40));

  const riskDist = dbModule.query(`
    SELECT risk_level, COUNT(*) as count 
    FROM changes 
    GROUP BY risk_level 
    ORDER BY count DESC
  `);
  console.log('风险等级分布:');
  riskDist.forEach(r => {
    const tag = r.risk_level === 'high' ? '高' : r.risk_level === 'medium' ? '中' : '低';
    console.log(`  - ${tag}风险: ${r.count} 条`);
  });

  const statusDist = dbModule.query(`
    SELECT status, COUNT(*) as count 
    FROM releases 
    GROUP BY status
  `);
  console.log('发布单状态分布:');
  statusDist.forEach(s => {
    console.log(`  - ${s.status}: ${s.count} 个`);
  });

  const confirmedDist = dbModule.query(`
    SELECT confirmed, COUNT(*) as count 
    FROM changes 
    GROUP BY confirmed
  `);
  const confirmed = confirmedDist.find(c => c.confirmed === 1)?.count || 0;
  const unconfirmed = confirmedDist.find(c => c.confirmed === 0)?.count || 0;
  console.log(`确认状态分布: 已确认 ${confirmed} 条, 待确认 ${unconfirmed} 条`);

  const unlinkedReqs = dbModule.query(`
    SELECT COUNT(*) as count FROM changes 
    WHERE requirement_id IS NULL OR requirement_id = ''
  `)[0].count;
  console.log(`未关联需求的变更: ${unlinkedReqs} 条`);
  console.log('');

  console.log('4. 发布单详情检查');
  console.log('-'.repeat(40));
  const releasesWithStats = dbModule.query(`
    SELECT r.id, r.name, r.status,
      COUNT(c.id) as change_count,
      SUM(CASE WHEN c.confirmed = 1 THEN 1 ELSE 0 END) as confirmed_count,
      SUM(CASE WHEN c.risk_level = 'high' THEN 1 ELSE 0 END) as high_risk_count
    FROM releases r
    LEFT JOIN changes c ON r.id = c.release_id
    GROUP BY r.id
    ORDER BY r.created_at DESC
  `);
  releasesWithStats.forEach(r => {
    const progress = r.change_count > 0 ? Math.round(r.confirmed_count / r.change_count * 100) : 0;
    console.log(`  [${r.status}] ${r.name}`);
    console.log(`    变更: ${r.change_count} | 已确认: ${r.confirmed_count} (${progress}%) | 高风险: ${r.high_risk_count}`);
  });
  console.log('');

  console.log('='.repeat(60));
  console.log('验证结果汇总');
  console.log('='.repeat(60));
  
  let exitCode = 0;
  if (errors.length > 0) {
    console.log(`❌ 发现 ${errors.length} 个错误:`);
    errors.forEach((e, i) => console.log(`  ${i + 1}. ${e}`));
    console.log('');
    exitCode = 1;
  } else if (warnings.length > 0) {
    console.log(`⚠️  注意事项: ${warnings.length} 项`);
    warnings.forEach((w, i) => console.log(`  ${i + 1}. ${w}`));
    console.log('');
    console.log('✅ 核心数据验证通过！');
  } else {
    console.log('✅ 所有验证检查通过！数据完整且符合要求。');
  }
  return exitCode;
}

async function main() {
  let exitCode = 0;
  try {
    await dbModule.initDb(dbPath);
    exitCode = check();
  } catch (err) {
    console.error('\n❌ 数据验证失败:', err.message);
    console.error(err.stack);
    exitCode = 1;
  } finally {
    dbModule.closeDb();
    setTimeout(() => process.exit(exitCode), 50);
  }
}

main();
