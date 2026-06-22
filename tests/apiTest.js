const http = require('http');

const BASE_URL = 'localhost';
const PORT = 3000;

let passed = 0;
let failed = 0;
const results = [];

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
          const json = JSON.parse(data);
          resolve({ status: res.statusCode, body: json });
        } catch (e) {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });

    req.on('error', reject);

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
    throw new Error(`${message || 'Status assertion failed'}: expected ${expectedStatus}, got ${response.status}`);
  }
}

async function runTests() {
  console.log('='.repeat(60));
  console.log('多仓库发布变更影响分析平台 - 接口验证脚本');
  console.log('='.repeat(60));
  console.log(`测试目标: http://${BASE_URL}:${PORT}/api`);
  console.log('');

  console.log('1. 健康检查');
  await test('GET /health 返回 200', async () => {
    const res = await request('GET', '/health');
    assertStatus(res, 200);
    assert(res.body.status === 'ok', 'status should be ok');
  });
  console.log('');

  console.log('2. 仓库管理');
  let repoId;
  await test('GET /repositories 获取仓库列表', async () => {
    const res = await request('GET', '/repositories');
    assertStatus(res, 200);
    assert(Array.isArray(res.body.data), 'data should be array');
    assert(res.body.data.length >= 4, 'should have at least 4 repositories');
  });

  await test('POST /repositories 创建仓库', async () => {
    const res = await request('POST', '/repositories', {
      name: 'test-repo-api',
      url: 'git@test.com:test/api-test.git',
      description: 'API测试仓库'
    });
    assertStatus(res, 200);
    assert(res.body.data, 'should return created repo');
    assert(res.body.data.name === 'test-repo-api', 'name should match');
    repoId = res.body.data.id;
  });

  await test('GET /repositories/:id 获取仓库详情', async () => {
    const res = await request('GET', `/repositories/${repoId}`);
    assertStatus(res, 200);
    assert(res.body.data.name === 'test-repo-api', 'name should match');
  });

  await test('PUT /repositories/:id 更新仓库', async () => {
    const res = await request('PUT', `/repositories/${repoId}`, {
      description: '更新后的描述'
    });
    assertStatus(res, 200);
    assert(res.body.data.description === '更新后的描述', 'description should be updated');
  });
  console.log('');

  console.log('3. 服务管理');
  let serviceId;
  await test('GET /services 获取服务列表', async () => {
    const res = await request('GET', '/services');
    assertStatus(res, 200);
    assert(Array.isArray(res.body.data), 'data should be array');
    assert(res.body.data.length >= 8, 'should have at least 8 services');
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
      name: 'test-service-api',
      repository_id: repoId,
      path_prefix: '/test',
      description: 'API测试服务'
    });
    assertStatus(res, 200);
    assert(res.body.data.name === 'test-service-api', 'name should match');
    serviceId = res.body.data.id;
  });
  console.log('');

  console.log('4. 发布单管理');
  let releaseId;
  await test('GET /releases 获取发布单列表', async () => {
    const res = await request('GET', '/releases');
    assertStatus(res, 200);
    assert(Array.isArray(res.body.data), 'data should be array');
    assert(res.body.data.length >= 3, 'should have at least 3 releases');
  });

  await test('GET /releases?status=pending 按状态筛选', async () => {
    const res = await request('GET', '/releases?status=pending');
    assertStatus(res, 200);
    assert(Array.isArray(res.body.data), 'data should be array');
    res.body.data.forEach(r => assert(r.status === 'pending', 'status should be pending'));
  });

  await test('POST /releases 创建发布单', async () => {
    const res = await request('POST', '/releases', {
      name: 'API测试发布单',
      version: 'v1.0.0-test',
      status: 'pending',
      planned_date: '2024-12-31',
      description: '这是一个API测试用的发布单'
    });
    assertStatus(res, 200);
    assert(res.body.data, 'should return created release');
    assert(res.body.data.name === 'API测试发布单', 'name should match');
    releaseId = res.body.data.id;
  });

  await test('GET /releases/:id 获取发布单详情', async () => {
    const res = await request('GET', `/releases/${releaseId}`);
    assertStatus(res, 200);
    assert(res.body.data.name === 'API测试发布单', 'name should match');
  });

  await test('PUT /releases/:id 更新发布单', async () => {
    const res = await request('PUT', `/releases/${releaseId}`, {
      status: 'testing',
      description: '更新后的发布单描述'
    });
    assertStatus(res, 200);
    assert(res.body.data.status === 'testing', 'status should be updated');
    assert(res.body.data.description === '更新后的发布单描述', 'description should be updated');
  });
  console.log('');

  console.log('5. 变更管理');
  let changeId;
  await test('POST /releases/:id/import-changes 导入变更', async () => {
    const res = await request('POST', `/releases/${releaseId}/import-changes`, {
      changes: [
        {
          file_path: 'test/src/Test1.java',
          change_type: 'add',
          module: 'test-module',
          service_name: 'test-service-api',
          repository_name: 'test-repo-api',
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
          service_name: 'test-service-api',
          committer: '测试人员',
          risk_level: 'medium',
          description: '测试变更2'
        },
        {
          file_path: 'test/sql/test.sql',
          change_type: 'modify',
          module: 'db',
          service_name: 'test-service-api',
          committer: 'DBA',
          risk_level: 'high',
          description: '数据库变更测试'
        }
      ]
    });
    assertStatus(res, 200);
    assert(res.body.success_count === 3, 'should import 3 changes');
  });

  await test('GET /changes 获取变更列表', async () => {
    const res = await request('GET', '/changes');
    assertStatus(res, 200);
    assert(Array.isArray(res.body.data), 'data should be array');
  });

  await test('GET /changes?release_id=:id 按发布单筛选', async () => {
    const res = await request('GET', `/changes?release_id=${releaseId}`);
    assertStatus(res, 200);
    assert(res.body.data.length === 3, 'should have 3 changes');
    changeId = res.body.data[0].id;
  });

  await test('GET /changes?risk_level=high 按风险等级筛选', async () => {
    const res = await request('GET', '/changes?risk_level=high');
    assertStatus(res, 200);
    res.body.data.forEach(c => assert(c.risk_level === 'high', 'risk level should be high'));
  });

  await test('GET /changes?change_type=add 按变更类型筛选', async () => {
    const res = await request('GET', '/changes?change_type=add');
    assertStatus(res, 200);
    res.body.data.forEach(c => assert(c.change_type === 'add', 'change type should be add'));
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

  await test('GET /changes/:id 获取变更详情', async () => {
    const res = await request('GET', `/changes/${changeId}`);
    assertStatus(res, 200);
    assert(res.body.data, 'should return change data');
  });

  await test('PUT /changes/:id 更新变更', async () => {
    const res = await request('PUT', `/changes/${changeId}`, {
      description: '更新后的变更描述',
      risk_level: 'low'
    });
    assertStatus(res, 200);
    assert(res.body.data.description === '更新后的变更描述', 'description should be updated');
    assert(res.body.data.risk_level === 'low', 'risk level should be updated');
  });

  await test('POST /changes/:id/confirm 确认变更', async () => {
    const res = await request('POST', `/changes/${changeId}/confirm`, {
      confirmed_by: '测试管理员'
    });
    assertStatus(res, 200);
    assert(res.body.data.confirmed === 1, 'should be confirmed');
    assert(res.body.data.confirmed_by === '测试管理员', 'confirmed_by should match');
  });

  await test('POST /changes/:id/unconfirm 取消确认', async () => {
    const res = await request('POST', `/changes/${changeId}/unconfirm`);
    assertStatus(res, 200);
    assert(res.body.data.confirmed === 0, 'should be unconfirmed');
  });
  console.log('');

  console.log('6. 影响分析');
  await test('GET /impact/release/:id 影响范围计算', async () => {
    const mainReleaseId = 1;
    const res = await request('GET', `/impact/release/${mainReleaseId}`);
    assertStatus(res, 200);
    assert(res.body.data, 'should return impact data');
    assert(res.body.data.total_changes > 0, 'should have changes');
    assert(Array.isArray(res.body.data.impacted_services), 'should have impacted services');
    assert(res.body.data.risk_assessment, 'should have risk assessment');
  });

  await test('GET /impact/release/:id/topology 影响拓扑视图', async () => {
    const mainReleaseId = 1;
    const res = await request('GET', `/impact/release/${mainReleaseId}/topology`);
    assertStatus(res, 200);
    assert(res.body.data.nodes, 'should have nodes');
    assert(res.body.data.edges, 'should have edges');
    assert(res.body.data.analysis, 'should have analysis');
  });

  await test('GET /impact/cross-service/:id 跨服务依赖识别', async () => {
    const mainReleaseId = 1;
    const res = await request('GET', `/impact/cross-service/${mainReleaseId}`);
    assertStatus(res, 200);
    assert(Array.isArray(res.body.data), 'should return array');
  });

  await test('GET /impact/db-impact/:id 数据库表影响识别', async () => {
    const mainReleaseId = 1;
    const res = await request('GET', `/impact/db-impact/${mainReleaseId}`);
    assertStatus(res, 200);
    assert(res.body.data.db_changes, 'should have db changes');
    assert(res.body.data.impacted_tables, 'should have impacted tables');
  });

  await test('GET /impact/high-risk/:id 高风险发布项', async () => {
    const mainReleaseId = 1;
    const res = await request('GET', `/impact/high-risk/${mainReleaseId}`);
    assertStatus(res, 200);
    assert(res.body.data.high_risk_changes, 'should have high risk changes');
    assert(res.body.data.risk_assessment, 'should have risk assessment');
  });

  await test('GET /impact/unlinked-requirements/:id 未关联需求变更', async () => {
    const mainReleaseId = 1;
    const res = await request('GET', `/impact/unlinked-requirements/${mainReleaseId}`);
    assertStatus(res, 200);
    assert(Array.isArray(res.body.data), 'should return array');
  });
  console.log('');

  console.log('7. 确认状态流转');
  await test('待确认 -> 已确认 -> 待确认 完整流转', async () => {
    const changesRes = await request('GET', `/changes?release_id=${releaseId}&confirmed=0`);
    assert(changesRes.body.data.length > 0, 'should have pending changes');
    const testChangeId = changesRes.body.data[0].id;

    const confirmRes = await request('POST', `/changes/${testChangeId}/confirm`, { confirmed_by: '流转测试' });
    assert(confirmRes.body.data.confirmed === 1, 'should be confirmed after confirm');

    const unconfirmRes = await request('POST', `/changes/${testChangeId}/unconfirm`);
    assert(unconfirmRes.body.data.confirmed === 0, 'should be unconfirmed after unconfirm');
  });
  console.log('');

  console.log('8. 统计看板');
  await test('GET /statistics/overview 获取总览统计', async () => {
    const res = await request('GET', '/statistics/overview');
    assertStatus(res, 200);
    assert(res.body.data.overview, 'should have overview');
    assert(res.body.data.overview.total_releases > 0, 'should have releases');
    assert(res.body.data.overview.total_changes > 0, 'should have changes');
    assert(res.body.data.overview.total_services > 0, 'should have services');
  });

  await test('GET /statistics/dashboard 获取看板数据', async () => {
    const res = await request('GET', '/statistics/dashboard');
    assertStatus(res, 200);
    assert(res.body.data.overview, 'should have overview');
    assert(res.body.data.risk_distribution, 'should have risk distribution');
    assert(res.body.data.release_status_distribution, 'should have release status distribution');
    assert(res.body.data.confirmation_distribution, 'should have confirmation distribution');
    assert(res.body.data.top_services_by_changes, 'should have top services');
    assert(res.body.data.top_committers, 'should have top committers');
    assert(res.body.data.recent_releases, 'should have recent releases');
    assert(res.body.data.pending_changes, 'should have pending changes');
    assert(res.body.data.high_risk_changes, 'should have high risk changes');
  });

  await test('GET /statistics/release-board 获取发布验收看板', async () => {
    const res = await request('GET', '/statistics/release-board');
    assertStatus(res, 200);
    assert(res.body.data.todo, 'should have todo column');
    assert(res.body.data.in_progress, 'should have in_progress column');
    assert(res.body.data.done, 'should have done column');
    assert(res.body.data.all, 'should have all releases');
  });
  console.log('');

  console.log('9. 综合验证 - 新发布单完整流程');
  await test('创建发布单 -> 导入变更 -> 影响分析 -> 确认变更 完整流程', async () => {
    const createRes = await request('POST', '/releases', {
      name: '综合测试发布单',
      version: 'v2.0.0-integration',
      status: 'pending',
      description: '综合流程测试'
    });
    const testReleaseId = createRes.body.data.id;

    const importRes = await request('POST', `/releases/${testReleaseId}/import-changes`, {
      changes: [
        { file_path: 'user-service/src/User.java', change_type: 'modify', service_name: 'user-service', committer: '张三', risk_level: 'medium', requirement_id: 'REQ-INT-001', description: '用户类修改' },
        { file_path: 'order-service/src/Order.java', change_type: 'modify', service_name: 'order-service', committer: '王五', risk_level: 'high', requirement_id: 'REQ-INT-002', description: '订单类修改' },
        { file_path: 'order-service/sql/schema.sql', change_type: 'modify', service_name: 'order-service', committer: 'DBA', risk_level: 'high', module: 'db', description: '数据库表结构变更' }
      ]
    });
    assert(importRes.body.success_count === 3, 'should import 3 changes');

    const impactRes = await request('GET', `/impact/release/${testReleaseId}`);
    assert(impactRes.body.data.total_changes === 3, 'should have 3 changes');
    assert(impactRes.body.data.impacted_services.length >= 2, 'should impact at least 2 services');
    assert(impactRes.body.data.risk_assessment.high_risk_count === 2, 'should have 2 high risk changes');

    const crossServiceRes = await request('GET', `/impact/cross-service/${testReleaseId}`);
    assert(Array.isArray(crossServiceRes.body.data), 'should return cross service impact');

    const dbImpactRes = await request('GET', `/impact/db-impact/${testReleaseId}`);
    assert(dbImpactRes.body.data.db_changes.length >= 1, 'should have db changes');

    const changesRes = await request('GET', `/changes?release_id=${testReleaseId}`);
    const changeIds = changesRes.body.data.map(c => c.id);
    
    for (const cid of changeIds) {
      await request('POST', `/changes/${cid}/confirm`, { confirmed_by: '测试管理员' });
    }

    const confirmedRes = await request('GET', `/changes?release_id=${testReleaseId}&confirmed=1`);
    assert(confirmedRes.body.data.length === 3, 'all changes should be confirmed');
  });
  console.log('');

  console.log('10. 数据验证 - 示例数据完整性');
  await test('验证仓库数量 >= 4', async () => {
    const res = await request('GET', '/repositories');
    assert(res.body.data.length >= 4, `仓库数量应为 >= 4，实际为 ${res.body.data.length}`);
  });

  await test('验证服务数量 >= 8', async () => {
    const res = await request('GET', '/services');
    assert(res.body.data.length >= 8, `服务数量应为 >= 8，实际为 ${res.body.data.length}`);
  });

  await test('验证变更数量 >= 20', async () => {
    const res = await request('GET', '/changes');
    assert(res.body.data.length >= 20, `变更数量应为 >= 20，实际为 ${res.body.data.length}`);
  });

  await test('验证服务依赖关系数量', async () => {
    const res = await request('GET', '/services/dependencies');
    assert(res.body.data.length > 5, `服务依赖数量应 > 5，实际为 ${res.body.data.length}`);
  });
  console.log('');

  console.log('='.repeat(60));
  console.log('测试结果汇总');
  console.log('='.repeat(60));
  console.log(`通过: ${passed}`);
  console.log(`失败: ${failed}`);
  console.log(`总计: ${passed + failed}`);
  console.log('');

  if (failed > 0) {
    console.log('失败的测试:');
    results.filter(r => r.status === 'fail').forEach(r => {
      console.log(`  - ${r.name}: ${r.error}`);
    });
    process.exit(1);
  } else {
    console.log('🎉 所有测试通过！');
    process.exit(0);
  }
}

setTimeout(runTests, 1000);
