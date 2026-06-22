const http = require('http');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const BASE_URL = 'localhost';
const PORT = process.env.TEST_PORT || 3099;
const PROJECT_ROOT = path.join(__dirname, '..');

let serverProcess = null;
let passed = 0;
let failed = 0;
const results = [];
const startedByScript = false;

function test(name, fn) {
  return new Promise(async (resolve) => {
    try {
      await fn();
      console.log(`  ✓ ${name}`);
      passed++;
      results.push({ name, status: 'pass' });
    } catch (err) {
      console.log(`  ✗ ${name}`);
      console.log(`    Error: ${err.message}`);
      failed++;
      results.push({ name, status: 'fail', error: err.message });
    }
    resolve();
  });
}

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: BASE_URL,
      port: PORT,
      path: '/api' + path,
      method: method,
      headers: {
        'Content-Type': 'application/json'
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const json = data ? JSON.parse(data) : {};
          resolve({ status: res.statusCode, body: json });
        } catch (e) {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(10000, () => {
      req.destroy(new Error('Request timeout'));
    });

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message || 'Assertion failed');
  }
}

function assertStatus(response, expectedStatus, message) {
  if (response.status !== expectedStatus) {
    const bodyStr = typeof response.body === 'object' ? JSON.stringify(response.body).substring(0, 200) : String(response.body).substring(0, 200);
    throw new Error(`${message || 'Status assertion failed'}: expected ${expectedStatus}, got ${response.status}. Body: ${bodyStr}`);
  }
}

function waitFor(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isServerRunning() {
  return new Promise((resolve) => {
    const req = http.request({
      hostname: BASE_URL,
      port: PORT,
      path: '/api/health',
      method: 'GET',
      timeout: 2000
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve(json.status === 'ok');
        } catch (e) {
          resolve(false);
        }
      });
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.end();
  });
}

async function startServer() {
  const isRunning = await isServerRunning();
  if (isRunning) {
    console.log(`ℹ️  检测到服务已在端口 ${PORT} 运行，复用现有实例`);
    return false;
  }

  console.log(`🚀 启动服务 (端口 ${PORT})...`);

  const env = { ...process.env, PORT: String(PORT) };
  serverProcess = spawn('node', ['server.js'], {
    cwd: PROJECT_ROOT,
    env: env,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let serverOutput = '';
  serverProcess.stdout.on('data', (data) => {
    serverOutput += data.toString();
  });
  serverProcess.stderr.on('data', (data) => {
    serverOutput += data.toString();
  });

  const startTime = Date.now();
  const timeoutMs = 15000;
  while (Date.now() - startTime < timeoutMs) {
    await waitFor(500);
    const running = await isServerRunning();
    if (running) {
      console.log(`✅ 服务启动成功 (耗时 ${Date.now() - startTime}ms)`);
      return true;
    }
    if (!serverProcess || serverProcess.killed) {
      console.error(`❌ 服务启动失败，输出:\n${serverOutput}`);
      throw new Error('Service failed to start');
    }
  }

  console.error(`❌ 服务启动超时，输出:\n${serverOutput}`);
  throw new Error('Service startup timeout');
}

function stopServer() {
  if (serverProcess && !serverProcess.killed) {
    console.log('🛑 停止服务进程...');
    try {
      serverProcess.kill('SIGTERM');
      setTimeout(() => {
        if (!serverProcess.killed) {
          serverProcess.kill('SIGKILL');
        }
      }, 2000);
      console.log('✅ 服务已停止');
    } catch (err) {
      console.warn('停止服务时出错:', err.message);
    }
  }
}

process.on('SIGINT', () => {
  stopServer();
  process.exit(130);
});
process.on('SIGTERM', () => {
  stopServer();
  process.exit(143);
});

async function runTests() {
  let weStarted = false;
  try {
    weStarted = await startServer();
  } catch (err) {
    console.error('服务启动失败:', err.message);
    process.exit(1);
  }

  console.log('');
  console.log('='.repeat(60));
  console.log('多仓库发布变更影响分析平台 - 接口验证脚本');
  console.log('='.repeat(60));
  console.log(`测试目标: http://${BASE_URL}:${PORT}/api`);
  console.log(`服务模式: ${weStarted ? '脚本自动启动' : '复用现有实例'}`);
  console.log('');

  let releaseId;
  console.log('1. 健康检查');
  await test('GET /health 返回 200 并 status=ok', async () => {
    const res = await request('GET', '/health');
    assertStatus(res, 200);
    assert(res.body.status === 'ok', 'status should be ok');
  });
  console.log('');

  console.log('2. 仓库管理');
  let repoId;
  await test('GET /repositories 获取仓库列表 (>=4个)', async () => {
    const res = await request('GET', '/repositories');
    assertStatus(res, 200);
    assert(Array.isArray(res.body.data), 'data should be array');
    assert(res.body.data.length >= 4, `should have at least 4 repositories, got ${res.body.data.length}`);
  });

  await test('POST /repositories 创建仓库', async () => {
    const res = await request('POST', '/repositories', {
      name: 'test-repo-api-' + Date.now(),
      url: 'git@test.com:test/api-test.git',
      description: 'API测试仓库'
    });
    assertStatus(res, 200);
    assert(res.body.data, 'should return created repo');
    repoId = res.body.data.id;
  });

  await test('GET /repositories/:id 获取仓库详情', async () => {
    const res = await request('GET', `/repositories/${repoId}`);
    assertStatus(res, 200);
    assert(res.body.data, 'should return repo data');
  });
  console.log('');

  console.log('3. 服务管理');
  let serviceId;
  await test('GET /services 获取服务列表 (>=8个)', async () => {
    const res = await request('GET', '/services');
    assertStatus(res, 200);
    assert(Array.isArray(res.body.data), 'data should be array');
    assert(res.body.data.length >= 8, `should have at least 8 services, got ${res.body.data.length}`);
  });

  await test('GET /services/dependencies 获取服务依赖', async () => {
    const res = await request('GET', '/services/dependencies');
    assertStatus(res, 200);
    assert(Array.isArray(res.body.data), 'data should be array');
    assert(res.body.data.length > 0, 'should have dependencies');
  });

  await test('GET /services/dependency-graph 获取依赖图', async () => {
    const res = await request('GET', '/services/dependency-graph');
    assertStatus(res, 200);
    assert(res.body.data.nodes, 'should have nodes');
    assert(res.body.data.edges, 'should have edges');
  });

  await test('POST /services 创建服务', async () => {
    const res = await request('POST', '/services', {
      name: 'test-service-api-' + Date.now(),
      repository_id: repoId,
      path_prefix: '/test',
      description: 'API测试服务'
    });
    assertStatus(res, 200);
    assert(res.body.data, 'should return created service');
    serviceId = res.body.data.id;
  });
  console.log('');

  console.log('4. 发布单管理');
  let createReleaseId;
  await test('GET /releases 获取发布单列表 (>=3个)', async () => {
    const res = await request('GET', '/releases');
    assertStatus(res, 200);
    assert(Array.isArray(res.body.data), 'data should be array');
    assert(res.body.data.length >= 3, `should have at least 3 releases, got ${res.body.data.length}`);
    if (res.body.data.length > 0) {
      releaseId = res.body.data[0].id;
    }
  });

  await test('POST /releases 创建发布单', async () => {
    const res = await request('POST', '/releases', {
      name: 'API测试发布单-' + Date.now(),
      version: 'v1.0.0-test',
      status: 'pending',
      planned_date: '2024-12-31',
      description: '这是一个API测试用的发布单'
    });
    assertStatus(res, 200);
    assert(res.body.data, 'should return created release');
    createReleaseId = res.body.data.id;
  });

  await test('GET /releases/:id 获取发布单详情', async () => {
    const res = await request('GET', `/releases/${createReleaseId}`);
    assertStatus(res, 200);
    assert(res.body.data, 'should return release');
  });
  console.log('');

  console.log('5. 变更导入与筛选');
  let changeIds = [];
  await test('POST /releases/:id/import-changes 导入变更', async () => {
    const res = await request('POST', `/releases/${createReleaseId}/import-changes`, {
      changes: [
        {
          file_path: 'test/src/Test1.java',
          change_type: 'add',
          module: 'test-module',
          service_name: 'user-service',
          repository_name: 'user-center',
          committer: '测试人员',
          risk_level: 'high',
          requirement_id: 'REQ-TEST-001',
          requirement_title: '测试需求1',
          description: '测试变更1'
        },
        {
          file_path: 'test/src/Test2.java',
          change_type: 'modify',
          module: 'test-module',
          service_name: 'order-service',
          committer: '测试人员',
          risk_level: 'medium',
          description: '测试变更2 - 未关联需求'
        },
        {
          file_path: 'test/sql/test_schema.sql',
          change_type: 'modify',
          module: 'db',
          service_name: 'order-service',
          committer: 'DBA',
          risk_level: 'high',
          requirement_id: 'REQ-TEST-002',
          description: '数据库变更测试 - 涉及表'
        }
      ]
    });
    assertStatus(res, 200);
    assert(res.body.success_count === 3, `should import 3 changes, got ${res.body.success_count}`);
  });

  await test('GET /changes?release_id=:id 按发布单筛选 (3条)', async () => {
    const res = await request('GET', `/changes?release_id=${createReleaseId}`);
    assertStatus(res, 200);
    assert(res.body.data.length === 3, `should have 3 changes, got ${res.body.data.length}`);
    changeIds = res.body.data.map(c => c.id);
  });

  await test('GET /changes?risk_level=high 按风险等级筛选', async () => {
    const res = await request('GET', '/changes?risk_level=high');
    assertStatus(res, 200);
    res.body.data.forEach(c => assert(c.risk_level === 'high', `risk level should be high, got ${c.risk_level}`));
  });

  await test('GET /changes?change_type=add 按变更类型筛选', async () => {
    const res = await request('GET', '/changes?change_type=add');
    assertStatus(res, 200);
    res.body.data.forEach(c => assert(c.change_type === 'add', `change type should be add`));
  });

  await test('GET /changes/pending 获取待确认变更', async () => {
    const res = await request('GET', '/changes/pending');
    assertStatus(res, 200);
    assert(Array.isArray(res.body.data), 'data should be array');
  });

  await test('GET /changes/high-risk 获取高风险变更', async () => {
    const res = await request('GET', '/changes/high-risk');
    assertStatus(res, 200);
    assert(Array.isArray(res.body.data), 'data should be array');
  });

  await test('GET /changes/unlinked-requirements 获取未关联需求变更', async () => {
    const res = await request('GET', '/changes/unlinked-requirements');
    assertStatus(res, 200);
    assert(Array.isArray(res.body.data), 'data should be array');
  });
  console.log('');

  console.log('6. 影响计算与风险评分');
  await test('GET /impact/release/:id 影响范围计算', async () => {
    const res = await request('GET', `/impact/release/${releaseId}`);
    assertStatus(res, 200);
    assert(res.body.data, 'should return impact data');
    assert(res.body.data.total_changes > 0, 'should have changes');
    assert(Array.isArray(res.body.data.impacted_services), 'should have impacted services');
    assert(res.body.data.risk_assessment, 'should have risk assessment');
    assert(res.body.data.risk_score, 'should have risk score');
    assert(typeof res.body.data.risk_score.score === 'number', 'risk score should be numeric');
    assert(Array.isArray(res.body.data.risk_score.risk_reasons), 'should have risk reasons list');
    assert(Array.isArray(res.body.data.risk_score.suggestions), 'should have suggestions list');
    assert(res.body.data.risk_score.score_details, 'should have score details');
    assert(Array.isArray(res.body.data.risk_score.score_details.change_risk_scores), 'should have per-change risk scores');
  });

  await test('GET /impact/release/:id/topology 影响拓扑视图', async () => {
    const res = await request('GET', `/impact/release/${releaseId}/topology`);
    assertStatus(res, 200);
    assert(res.body.data.nodes, 'should have nodes');
    assert(res.body.data.edges, 'should have edges');
    assert(res.body.data.analysis, 'should have analysis context');
  });

  await test('GET /impact/cross-service/:id 跨服务依赖识别', async () => {
    const res = await request('GET', `/impact/cross-service/${releaseId}`);
    assertStatus(res, 200);
    assert(Array.isArray(res.body.data), 'should return array of cross-service impacts');
  });

  await test('GET /impact/db-impact/:id 数据库表影响识别', async () => {
    const res = await request('GET', `/impact/db-impact/${releaseId}`);
    assertStatus(res, 200);
    assert(res.body.data.db_changes, 'should have db changes');
    assert(res.body.data.impacted_tables, 'should have impacted tables');
  });

  await test('GET /impact/high-risk/:id 高风险发布项 + 风险评分', async () => {
    const res = await request('GET', `/impact/high-risk/${releaseId}`);
    assertStatus(res, 200);
    assert(res.body.data.high_risk_changes, 'should have high risk changes');
    assert(res.body.data.risk_assessment, 'should have risk assessment');
  });
  console.log('');

  console.log('7. 批量确认 & 退回流转');
  await test('POST /changes/batch-confirm 批量确认变更', async () => {
    const ids = changeIds.slice(0, 2);
    assert(ids.length === 2, 'need at least 2 changes for batch test');
    const res = await request('POST', '/changes/batch-confirm', {
      ids,
      confirmed_by: '批量确认测试员',
      comment: '批量确认 - 已验证通过'
    });
    assertStatus(res, 200);
    assert(res.body.success_count === 2, `should batch confirm 2, got ${res.body.success_count}`);
  });

  await test('POST /changes/:id/reject 单个退回变更', async () => {
    assert(changeIds.length >= 3, 'need at least 3 changes');
    const rejectId = changeIds[2];
    const res = await request('POST', `/changes/${rejectId}/reject`, {
      rejected_by: '退回审核员',
      reason: '变更不符合规范，请补充SQL回滚脚本',
      comment: '需要补充完善后再提交'
    });
    assertStatus(res, 200);
    assert(res.body.data.rejected === 1, 'should be rejected');
    assert(res.body.data.rejected_by === '退回审核员', 'rejected_by should match');
  });

  await test('GET /changes/confirmation-progress/:releaseId 确认进度统计', async () => {
    const res = await request('GET', `/changes/confirmation-progress/${createReleaseId}`);
    assertStatus(res, 200);
    const d = res.body.data;
    assert(typeof d.total === 'number', 'should have total');
    assert(typeof d.confirmed === 'number', 'should have confirmed');
    assert(typeof d.rejected === 'number', 'should have rejected');
    assert(typeof d.pending === 'number', 'should have pending');
    assert(d.total === d.confirmed + d.rejected + d.pending, `total (${d.total}) should equal sum (${d.confirmed}+${d.rejected}+${d.pending})`);
    assert(d.owner_distribution, 'should have owner distribution');
    assert(d.service_distribution, 'should have service distribution');
  });

  await test('POST /changes/batch-reset 批量重置确认状态', async () => {
    const res = await request('POST', '/changes/batch-reset', {
      ids: changeIds,
      operator: '系统管理员',
      comment: '测试完成，重置状态'
    });
    assertStatus(res, 200);
    assert(res.body.success_count === changeIds.length, `should reset ${changeIds.length}, got ${res.body.success_count}`);
  });

  await test('POST /changes/batch-reject 批量退回变更', async () => {
    const res = await request('POST', '/changes/batch-reject', {
      ids: changeIds,
      rejected_by: '批量退回员',
      reason: '批量退回 - 需要重新评审',
      comment: '全部退回重审'
    });
    assertStatus(res, 200);
    assert(res.body.success_count === changeIds.length, `should batch reject ${changeIds.length}, got ${res.body.success_count}`);
  });
  console.log('');

  console.log('8. 组合筛选查询');
  await test('组合筛选: 仓库+服务+风险等级', async () => {
    const repos = await request('GET', '/repositories');
    const services = await request('GET', '/services');
    if (repos.body.data.length > 0 && services.body.data.length > 0) {
      const rid = repos.body.data[0].id;
      const sid = services.body.data[0].id;
      const res = await request('GET', `/changes?repository_id=${rid}&service_id=${sid}&risk_level=high`);
      assertStatus(res, 200);
      assert(Array.isArray(res.body.data), 'data should be array');
    }
  });

  await test('组合筛选: 确认状态+负责人', async () => {
    const ownerParam = encodeURIComponent('张三');
    const res = await request('GET', `/changes?confirmed=false&rejected=false&owner=${ownerParam}`);
    assertStatus(res, 200);
    assert(Array.isArray(res.body.data), 'data should be array');
    res.body.data.forEach(c => {
      assert(c.confirmed === 0, `should be unconfirmed, got ${c.confirmed}`);
      assert(c.rejected === 0, `should be unrejected, got ${c.rejected}`);
    });
  });
  console.log('');

  console.log('9. 统计看板');
  await test('GET /statistics/overview 获取总览统计', async () => {
    const res = await request('GET', '/statistics/overview');
    assertStatus(res, 200);
    assert(res.body.data.overview, 'should have overview');
    assert(res.body.data.overview.total_releases > 0, 'should have releases');
    assert(res.body.data.overview.total_changes >= 20, `should have >=20 changes, got ${res.body.data.overview.total_changes}`);
    assert(res.body.data.overview.total_services >= 8, `should have >=8 services, got ${res.body.data.overview.total_services}`);
  });

  await test('GET /statistics/dashboard 获取看板数据 (含待确认/高风险)', async () => {
    const res = await request('GET', '/statistics/dashboard');
    assertStatus(res, 200);
    const d = res.body.data;
    assert(d.overview, 'should have overview');
    assert(d.risk_distribution, 'should have risk distribution');
    assert(d.confirmation_distribution, 'should have confirmation distribution');
    assert(d.pending_changes, 'should have pending changes');
    assert(d.high_risk_changes, 'should have high risk changes');
    assert(d.rejected_changes, 'should have rejected changes');
    assert(d.releases, 'should have releases');
    assert(d.recent_operations, 'should have recent operations');
    assert(Array.isArray(d.unlinked_requirement_changes), 'should have unlinked requirement changes');
  });

  await test('GET /statistics/release-board 获取发布验收看板', async () => {
    const res = await request('GET', '/statistics/release-board');
    assertStatus(res, 200);
    assert(res.body.data.todo, 'should have todo column');
    assert(res.body.data.in_progress, 'should have in_progress column');
    assert(res.body.data.done, 'should have done column');
    assert(res.body.data.all, 'should have all releases');
  });

  await test('GET /statistics/releases-filter-options 获取筛选选项', async () => {
    const res = await request('GET', '/statistics/releases-filter-options');
    assertStatus(res, 200);
    const d = res.body.data;
    assert(Array.isArray(d.risk_levels), 'should have risk levels');
    assert(Array.isArray(d.change_types), 'should have change types');
    assert(Array.isArray(d.confirm_statuses), 'should have confirm statuses');
    assert(Array.isArray(d.repositories), 'should have repositories');
    assert(Array.isArray(d.services), 'should have services');
    assert(Array.isArray(d.owners), 'should have owners');
  });
  console.log('');

  console.log('10. 操作记录审计');
  await test('GET /changes/operations/:changeId 查看变更操作记录', async () => {
    assert(changeIds.length > 0, 'need at least one change id');
    const res = await request('GET', `/changes/operations/${changeIds[0]}`);
    assertStatus(res, 200);
    assert(Array.isArray(res.body.data), 'operations should be array');
    if (res.body.data.length > 0) {
      const op = res.body.data[0];
      assert(op.change_id, 'operation should have change_id');
      assert(op.operation_type, 'operation should have operation_type');
      assert(op.created_at, 'operation should have created_at');
    }
  });
  console.log('');

  console.log('11. 完整端到端流程验证');
  await test('E2E: 创建发布单 → 导入变更 → 影响分析 → 风险评分 → 批量确认 → 进度统计', async () => {
    const createRes = await request('POST', '/releases', {
      name: 'E2E测试发布单-' + Date.now(),
      version: 'v2.0.0-e2e',
      status: 'pending',
      description: '端到端流程测试'
    });
    const e2eReleaseId = createRes.body.data.id;

    const importRes = await request('POST', `/releases/${e2eReleaseId}/import-changes`, {
      changes: [
        { file_path: 'e2e/user/UserProfile.java', change_type: 'modify', service_name: 'user-service', committer: '张三', risk_level: 'medium', requirement_id: 'REQ-E2E-001', description: '用户档案修改' },
        { file_path: 'e2e/order/OrderManager.java', change_type: 'modify', service_name: 'order-service', committer: '王五', risk_level: 'high', requirement_id: 'REQ-E2E-002', description: '订单管理重构' },
        { file_path: 'e2e/order/sql/order_migration.sql', change_type: 'modify', service_name: 'order-service', committer: 'DBA', risk_level: 'high', module: 'db', requirement_id: 'REQ-E2E-002', description: '订单表变更' }
      ]
    });
    assert(importRes.body.success_count === 3, `e2e import should succeed: ${importRes.body.success_count}/3`);

    const impactRes = await request('GET', `/impact/release/${e2eReleaseId}`);
    assert(impactRes.body.data.total_changes === 3, `e2e total_changes should be 3, got ${impactRes.body.data.total_changes}`);
    assert(impactRes.body.data.risk_assessment.high_risk_count === 2, `e2e high_risk_count should be 2, got ${impactRes.body.data.risk_assessment.high_risk_count}`);
    assert(impactRes.body.data.risk_score.score >= 0, `e2e risk_score should be >= 0, got ${impactRes.body.data.risk_score.score}`);
    assert(impactRes.body.data.risk_score.risk_reasons.length > 0, 'e2e should have risk reasons');
    assert(impactRes.body.data.risk_score.suggestions.length > 0, 'e2e should have suggestions');
    assert(impactRes.body.data.risk_score.score_details.change_risk_scores.length === 3, 'e2e should have per-change scores');

    const changesRes = await request('GET', `/changes?release_id=${e2eReleaseId}`);
    const e2eIds = changesRes.body.data.map(c => c.id);
    assert(e2eIds.length === 3, 'should have 3 e2e changes');

    const confirmRes = await request('POST', '/changes/batch-confirm', {
      ids: e2eIds,
      confirmed_by: 'E2E确认人',
      comment: 'E2E测试 - 批量确认'
    });
    assert(confirmRes.body.success_count === 3, `e2e batch confirm should be 3/3, got ${confirmRes.body.success_count}`);

    const progressRes = await request('GET', `/changes/confirmation-progress/${e2eReleaseId}`);
    assert(progressRes.body.data.confirmed === 3, `e2e confirmed should be 3, got ${progressRes.body.data.confirmed}`);
    assert(progressRes.body.data.confirm_rate === 100, `e2e confirm_rate should be 100, got ${progressRes.body.data.confirm_rate}`);
  });
  console.log('');

  console.log('12. 数据完整性验证 (通过API再次检查)');
  await test('API验证: 仓库>=4, 服务>=8, 变更>=20', async () => {
    const [repoRes, svcRes, chgRes] = await Promise.all([
      request('GET', '/repositories'),
      request('GET', '/services'),
      request('GET', '/changes')
    ]);
    assert(repoRes.body.data.length >= 4, `仓库: ${repoRes.body.data.length} >=4`);
    assert(svcRes.body.data.length >= 8, `服务: ${svcRes.body.data.length} >=8`);
    assert(chgRes.body.data.length >= 20, `变更: ${chgRes.body.data.length} >=20`);
  });
  console.log('');

  console.log('='.repeat(60));
  console.log('测试结果汇总');
  console.log('='.repeat(60));
  console.log(`通过: ${passed}`);
  console.log(`失败: ${failed}`);
  console.log(`总计: ${passed + failed}`);
  console.log(`通过率: ${(passed / (passed + failed) * 100).toFixed(1)}%`);
  console.log('');

  if (failed > 0) {
    console.log('失败的测试:');
    results.filter(r => r.status === 'fail').forEach((r, i) => {
      console.log(`  ${i + 1}. ${r.name}: ${r.error}`);
    });
    console.log('');
    stopServer();
    process.exit(1);
  } else {
    console.log('🎉 所有测试通过！');
    stopServer();
    process.exit(0);
  }
}

runTests().catch(err => {
  console.error('\n❌ 测试运行异常:', err.message);
  console.error(err.stack);
  stopServer();
  process.exit(1);
});
