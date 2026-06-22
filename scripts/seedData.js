const path = require('path');
const dbModule = require('../db');

const dbPath = path.join(__dirname, '..', 'data', 'app.db');

function safeInsert(table, columns, values, checkFn) {
  try {
    const existing = checkFn();
    if (existing) {
      return { id: existing.id, inserted: false };
    }
    const placeholders = columns.map(() => '?').join(', ');
    const sql = `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`;
    const info = dbModule.run(sql, values);
    return { id: info.lastInsertRowid, inserted: true };
  } catch (err) {
    if (err.message && (err.message.includes('UNIQUE constraint') || err.message.includes('unique constraint'))) {
      const existing = checkFn();
      if (existing) {
        return { id: existing.id, inserted: false };
      }
    }
    throw err;
  }
}

async function main() {
  try {
  console.log('='.repeat(60));
  console.log('多仓库发布变更影响分析平台 - 种子数据导入');
  console.log('='.repeat(60));
  console.log(`数据库路径: ${dbPath}`);
  console.log('模式: 幂等导入 (已存在数据自动跳过)');
  console.log('');

  await dbModule.initDb(dbPath);
  console.log('✅ 数据库连接已建立');
  console.log('');

  let totalInserted = 0;
  let totalSkipped = 0;

  console.log('1. 导入仓库数据 (Repositories) 要求>=4...');
  const repos = [
    { name: 'user-center', url: 'git@git.example.com:platform/user-center.git', description: '用户中心服务仓库' },
    { name: 'order-service', url: 'git@git.example.com:trade/order-service.git', description: '订单服务仓库' },
    { name: 'payment-gateway', url: 'git@git.example.com:trade/payment-gateway.git', description: '支付网关仓库' },
    { name: 'data-platform', url: 'git@git.example.com:data/data-platform.git', description: '数据平台仓库' },
  ];

  const repoIds = {};
  const insertRepoStmt = dbModule.prepare('SELECT id FROM repositories WHERE name = ?');
  repos.forEach(r => {
    const result = safeInsert(
      'repositories',
      ['name', 'url', 'description'],
      [r.name, r.url, r.description],
      () => insertRepoStmt.get(r.name)
    );
    repoIds[r.name] = result.id;
    if (result.inserted) { totalInserted++; console.log(`  + ${r.name}`); }
    else { totalSkipped++; console.log(`  = ${r.name} (已存在, 跳过)`); }
  });
  console.log(`  完成: 插入${totalInserted - (totalInserted)} (累计), 跳过: 仓库 ${Object.keys(repoIds).length} 个就绪`);
  console.log('');

  let stepInserted = 0, stepSkipped = 0;
  console.log('2. 导入服务数据 (Services) 要求>=8...');
  const services = [
    { name: 'user-service', repo: 'user-center', path_prefix: '/user', description: '用户核心服务' },
    { name: 'auth-service', repo: 'user-center', path_prefix: '/auth', description: '认证授权服务' },
    { name: 'order-service', repo: 'order-service', path_prefix: '/order', description: '订单核心服务' },
    { name: 'inventory-service', repo: 'order-service', path_prefix: '/inventory', description: '库存服务' },
    { name: 'payment-service', repo: 'payment-gateway', path_prefix: '/payment', description: '支付核心服务' },
    { name: 'gateway-service', repo: 'payment-gateway', path_prefix: '/gateway', description: 'API网关服务' },
    { name: 'report-service', repo: 'data-platform', path_prefix: '/report', description: '报表服务' },
    { name: 'analytics-service', repo: 'data-platform', path_prefix: '/analytics', description: '数据分析服务' },
  ];

  const serviceIds = {};
  const insertServiceStmt = dbModule.prepare('SELECT id FROM services WHERE name = ?');
  services.forEach(s => {
    const result = safeInsert(
      'services',
      ['name', 'repository_id', 'path_prefix', 'description'],
      [s.name, repoIds[s.repo], s.path_prefix, s.description],
      () => insertServiceStmt.get(s.name)
    );
    serviceIds[s.name] = result.id;
    if (result.inserted) { stepInserted++; console.log(`  + ${s.name}`); }
    else { stepSkipped++; console.log(`  = ${s.name} (已存在, 跳过)`); }
  });
  totalInserted += stepInserted;
  totalSkipped += stepSkipped;
  console.log(`  完成: +${stepInserted} =${stepSkipped}, 服务 ${Object.keys(serviceIds).length} 个就绪`);
  console.log('');

  stepInserted = 0; stepSkipped = 0;
  console.log('3. 导入API接口数据 (APIs)...');
  const apis = [
    { name: 'getUserInfo', method: 'GET', path: '/api/user/info', service: 'user-service' },
    { name: 'updateUser', method: 'PUT', path: '/api/user/update', service: 'user-service' },
    { name: 'login', method: 'POST', path: '/api/auth/login', service: 'auth-service' },
    { name: 'refreshToken', method: 'POST', path: '/api/auth/refresh', service: 'auth-service' },
    { name: 'createOrder', method: 'POST', path: '/api/order/create', service: 'order-service' },
    { name: 'getOrder', method: 'GET', path: '/api/order/:id', service: 'order-service' },
    { name: 'listOrders', method: 'GET', path: '/api/order/list', service: 'order-service' },
    { name: 'deductStock', method: 'POST', path: '/api/inventory/deduct', service: 'inventory-service' },
    { name: 'getStock', method: 'GET', path: '/api/inventory/:sku', service: 'inventory-service' },
    { name: 'payOrder', method: 'POST', path: '/api/payment/pay', service: 'payment-service' },
    { name: 'refund', method: 'POST', path: '/api/payment/refund', service: 'payment-service' },
    { name: 'routeRequest', method: 'GET', path: '/api/gateway/route', service: 'gateway-service' },
    { name: 'getDailyReport', method: 'GET', path: '/api/report/daily', service: 'report-service' },
    { name: 'getUserBehavior', method: 'GET', path: '/api/analytics/behavior', service: 'analytics-service' },
  ];

  const apiIds = {};
  const insertApiStmt = dbModule.prepare('SELECT id FROM apis WHERE name = ? AND service_id = ?');
  apis.forEach(a => {
    const result = safeInsert(
      'apis',
      ['name', 'method', 'path', 'service_id', 'description'],
      [a.name, a.method, a.path, serviceIds[a.service], a.name],
      () => insertApiStmt.get(a.name, serviceIds[a.service])
    );
    apiIds[a.name] = result.id;
    if (result.inserted) stepInserted++;
    else stepSkipped++;
  });
  totalInserted += stepInserted;
  totalSkipped += stepSkipped;
  console.log(`  完成: +${stepInserted} =${stepSkipped}, APIs ${apis.length} 个就绪`);
  console.log('');

  stepInserted = 0; stepSkipped = 0;
  console.log('4. 导入数据库表数据 (DB Tables)...');
  const tables = [
    { name: 't_user', database: 'user_db', service: 'user-service', description: '用户主表' },
    { name: 't_user_profile', database: 'user_db', service: 'user-service', description: '用户资料表' },
    { name: 't_auth_token', database: 'auth_db', service: 'auth-service', description: '认证令牌表' },
    { name: 't_order', database: 'order_db', service: 'order-service', description: '订单主表' },
    { name: 't_order_item', database: 'order_db', service: 'order-service', description: '订单明细表' },
    { name: 't_inventory', database: 'inventory_db', service: 'inventory-service', description: '库存表' },
    { name: 't_payment', database: 'payment_db', service: 'payment-service', description: '支付记录表' },
    { name: 't_refund', database: 'payment_db', service: 'payment-service', description: '退款记录表' },
    { name: 't_report_daily', database: 'data_db', service: 'report-service', description: '日报表' },
    { name: 't_behavior_log', database: 'data_db', service: 'analytics-service', description: '行为日志表' },
  ];

  const tableIds = {};
  const insertTableStmt = dbModule.prepare('SELECT id FROM db_tables WHERE name = ?');
  tables.forEach(t => {
    const result = safeInsert(
      'db_tables',
      ['name', 'database_name', 'service_id', 'description'],
      [t.name, t.database, serviceIds[t.service], t.description],
      () => insertTableStmt.get(t.name)
    );
    tableIds[t.name] = result.id;
    if (result.inserted) stepInserted++;
    else stepSkipped++;
  });
  totalInserted += stepInserted;
  totalSkipped += stepSkipped;
  console.log(`  完成: +${stepInserted} =${stepSkipped}, 表 ${tables.length} 个就绪`);
  console.log('');

  stepInserted = 0; stepSkipped = 0;
  console.log('5. 导入服务依赖关系 (Service Dependencies)...');
  const serviceDeps = [
    { from: 'order-service', to: 'user-service', type: 'rpc', desc: '查询用户信息' },
    { from: 'order-service', to: 'inventory-service', type: 'rpc', desc: '扣减库存' },
    { from: 'order-service', to: 'payment-service', type: 'rpc', desc: '发起支付' },
    { from: 'payment-service', to: 'order-service', type: 'rpc', desc: '支付回调更新订单' },
    { from: 'gateway-service', to: 'auth-service', type: 'http', desc: '网关鉴权' },
    { from: 'gateway-service', to: 'user-service', type: 'http', desc: '路由用户请求' },
    { from: 'gateway-service', to: 'order-service', type: 'http', desc: '路由订单请求' },
    { from: 'report-service', to: 'order-service', type: 'db', desc: '读取订单数据' },
    { from: 'report-service', to: 'user-service', type: 'db', desc: '读取用户数据' },
    { from: 'analytics-service', to: 'user-service', type: 'rpc', desc: '获取用户画像' },
    { from: 'auth-service', to: 'user-service', type: 'rpc', desc: '验证用户账号' },
  ];

  const insertDepStmt = dbModule.prepare('SELECT id FROM service_dependencies WHERE from_service_id = ? AND to_service_id = ?');
  serviceDeps.forEach(d => {
    const result = safeInsert(
      'service_dependencies',
      ['from_service_id', 'to_service_id', 'dependency_type', 'description'],
      [serviceIds[d.from], serviceIds[d.to], d.type, d.desc],
      () => insertDepStmt.get(serviceIds[d.from], serviceIds[d.to])
    );
    if (result.inserted) stepInserted++;
    else stepSkipped++;
  });
  totalInserted += stepInserted;
  totalSkipped += stepSkipped;
  console.log(`  完成: +${stepInserted} =${stepSkipped}, 服务依赖 ${serviceDeps.length} 组就绪`);
  console.log('');

  stepInserted = 0; stepSkipped = 0;
  console.log('6. 导入API调用关系 (API Calls)...');
  const apiCalls = [
    { from: 'createOrder', to: 'getUserInfo', type: 'rpc' },
    { from: 'createOrder', to: 'deductStock', type: 'rpc' },
    { from: 'createOrder', to: 'payOrder', type: 'rpc' },
    { from: 'payOrder', to: 'getOrder', type: 'rpc' },
    { from: 'login', to: 'getUserInfo', type: 'rpc' },
    { from: 'refreshToken', to: 'getUserInfo', type: 'rpc' },
    { from: 'routeRequest', to: 'login', type: 'http' },
    { from: 'getDailyReport', to: 'listOrders', type: 'rpc' },
  ];

  const insertApiCallStmt = dbModule.prepare('SELECT id FROM api_calls WHERE from_api_id = ? AND to_api_id = ?');
  apiCalls.forEach(c => {
    const fromApi = apis.find(a => a.name === c.from);
    const toApi = apis.find(a => a.name === c.to);
    const result = safeInsert(
      'api_calls',
      ['from_api_id', 'to_api_id', 'from_service_id', 'to_service_id', 'call_type', 'description'],
      [apiIds[c.from], apiIds[c.to], serviceIds[fromApi.service], serviceIds[toApi.service], c.type, `${c.from} -> ${c.to}`],
      () => insertApiCallStmt.get(apiIds[c.from], apiIds[c.to])
    );
    if (result.inserted) stepInserted++;
    else stepSkipped++;
  });
  totalInserted += stepInserted;
  totalSkipped += stepSkipped;
  console.log(`  完成: +${stepInserted} =${stepSkipped}, API调用 ${apiCalls.length} 组就绪`);
  console.log('');

  stepInserted = 0; stepSkipped = 0;
  console.log('7. 导入数据库表引用关系 (Table References)...');
  const tableRefs = [
    { service: 'order-service', table: 't_user', type: 'read', desc: '订单查询用户信息' },
    { service: 'report-service', table: 't_order', type: 'read', desc: '报表统计订单' },
    { service: 'report-service', table: 't_order_item', type: 'read', desc: '报表统计明细' },
    { service: 'report-service', table: 't_user', type: 'read', desc: '报表关联用户' },
    { service: 'analytics-service', table: 't_user', type: 'read', desc: '分析用户行为' },
    { service: 'analytics-service', table: 't_behavior_log', type: 'write', desc: '写入行为日志' },
    { service: 'auth-service', table: 't_user', type: 'read', desc: '认证读取用户' },
    { service: 'payment-service', table: 't_order', type: 'read', desc: '支付读取订单' },
  ];

  const insertTableRefStmt = dbModule.prepare('SELECT id FROM table_references WHERE service_id = ? AND table_id = ?');
  tableRefs.forEach(r => {
    const result = safeInsert(
      'table_references',
      ['service_id', 'table_id', 'reference_type', 'description'],
      [serviceIds[r.service], tableIds[r.table], r.type, r.desc],
      () => insertTableRefStmt.get(serviceIds[r.service], tableIds[r.table])
    );
    if (result.inserted) stepInserted++;
    else stepSkipped++;
  });
  totalInserted += stepInserted;
  totalSkipped += stepSkipped;
  console.log(`  完成: +${stepInserted} =${stepSkipped}, 表引用 ${tableRefs.length} 组就绪`);
  console.log('');

  stepInserted = 0; stepSkipped = 0;
  console.log('8. 导入发布单数据 (Releases)...');
  const releases = [
    { name: '2024.06.20 版本发布', version: 'v2.3.0', status: 'pending', planned_date: '2024-06-20', description: '月度例行版本发布，包含用户中心和订单系统升级' },
    { name: '2024.06.15 紧急修复', version: 'v2.2.1-hotfix', status: 'released', planned_date: '2024-06-15', description: '支付网关紧急安全修复' },
    { name: '2024.06.10 版本发布', version: 'v2.2.0', status: 'released', planned_date: '2024-06-10', description: '数据平台功能升级' },
  ];

  const releaseIds = {};
  const insertReleaseStmt = dbModule.prepare('SELECT id FROM releases WHERE name = ?');
  releases.forEach(r => {
    const result = safeInsert(
      'releases',
      ['name', 'version', 'status', 'planned_date', 'description'],
      [r.name, r.version, r.status, r.planned_date, r.description],
      () => insertReleaseStmt.get(r.name)
    );
    releaseIds[r.name] = result.id;
    if (result.inserted) stepInserted++;
    else stepSkipped++;
  });
  totalInserted += stepInserted;
  totalSkipped += stepSkipped;
  console.log(`  完成: +${stepInserted} =${stepSkipped}, 发布单 ${releases.length} 个就绪`);
  console.log('');

  stepInserted = 0; stepSkipped = 0;
  console.log('9. 导入变更数据 (Changes) 要求>=20...');
  const changes = [
    { release: '2024.06.20 版本发布', file: 'user-center/user-service/src/main/java/com/example/user/UserService.java', type: 'modify', module: 'user-core', service: 'user-service', repo: 'user-center', committer: '张三', risk: 'medium', reqId: 'REQ-2024-0601', reqTitle: '用户信息字段扩展', confirmed: 1, owner: '张三', desc: '新增用户等级字段' },
    { release: '2024.06.20 版本发布', file: 'user-center/user-service/src/main/resources/mapper/UserMapper.xml', type: 'modify', module: 'user-dao', service: 'user-service', repo: 'user-center', committer: '张三', risk: 'medium', reqId: 'REQ-2024-0601', reqTitle: '用户信息字段扩展', confirmed: 1, owner: '张三', desc: 'SQL查询字段调整' },
    { release: '2024.06.20 版本发布', file: 'user-center/auth-service/src/main/java/com/example/auth/AuthController.java', type: 'modify', module: 'auth-api', service: 'auth-service', repo: 'user-center', committer: '李四', risk: 'high', reqId: 'REQ-2024-0602', reqTitle: '登录安全加固', confirmed: 0, owner: '李四', desc: '增加登录失败次数限制' },
    { release: '2024.06.20 版本发布', file: 'order-service/order-service/src/main/java/com/example/order/OrderService.java', type: 'modify', module: 'order-core', service: 'order-service', repo: 'order-service', committer: '王五', risk: 'high', reqId: 'REQ-2024-0603', reqTitle: '订单流程优化', confirmed: 0, owner: '王五', desc: '订单创建流程重构' },
    { release: '2024.06.20 版本发布', file: 'order-service/order-service/src/main/java/com/example/order/OrderController.java', type: 'modify', module: 'order-api', service: 'order-service', repo: 'order-service', committer: '王五', risk: 'medium', reqId: 'REQ-2024-0603', reqTitle: '订单流程优化', confirmed: 1, owner: '王五', desc: '下单接口参数调整' },
    { release: '2024.06.20 版本发布', file: 'order-service/inventory-service/src/main/java/com/example/inventory/InventoryService.java', type: 'modify', module: 'inventory-core', service: 'inventory-service', repo: 'order-service', committer: '赵六', risk: 'medium', reqId: 'REQ-2024-0604', reqTitle: '库存预占优化', confirmed: 1, owner: '赵六', desc: '库存预占逻辑优化' },
    { release: '2024.06.20 版本发布', file: 'payment-gateway/payment-service/src/main/java/com/example/payment/PaymentService.java', type: 'modify', module: 'payment-core', service: 'payment-service', repo: 'payment-gateway', committer: '钱七', risk: 'high', reqId: 'REQ-2024-0605', reqTitle: '多渠道支付接入', confirmed: 0, owner: '钱七', desc: '新增微信支付渠道' },
    { release: '2024.06.20 版本发布', file: 'payment-gateway/gateway-service/src/main/java/com/example/gateway/GatewayFilter.java', type: 'modify', module: 'gateway-filter', service: 'gateway-service', repo: 'payment-gateway', committer: '钱七', risk: 'low', reqId: 'REQ-2024-0606', reqTitle: '网关日志增强', confirmed: 1, owner: '钱七', desc: '增加请求响应日志' },
    { release: '2024.06.20 版本发布', file: 'data-platform/report-service/src/main/java/com/example/report/DailyReportJob.java', type: 'modify', module: 'report-job', service: 'report-service', repo: 'data-platform', committer: '孙八', risk: 'low', reqId: 'REQ-2024-0607', reqTitle: '日报表字段补充', confirmed: 1, owner: '孙八', desc: '日报表新增用户统计字段' },
    { release: '2024.06.20 版本发布', file: 'data-platform/analytics-service/src/main/java/com/example/analytics/UserBehaviorAnalyzer.java', type: 'add', module: 'analytics-core', service: 'analytics-service', repo: 'data-platform', committer: '孙八', risk: 'medium', reqId: '', reqTitle: '', confirmed: 0, owner: '孙八', desc: '新增用户行为分析模块' },
    { release: '2024.06.20 版本发布', file: 'user-center/user-service/pom.xml', type: 'modify', module: 'build', service: 'user-service', repo: 'user-center', committer: '张三', risk: 'low', reqId: 'REQ-2024-0601', reqTitle: '用户信息字段扩展', confirmed: 1, owner: '张三', desc: '依赖版本升级' },
    { release: '2024.06.20 版本发布', file: 'order-service/order-service/src/main/resources/sql/init.sql', type: 'modify', module: 'db', service: 'order-service', repo: 'order-service', committer: '王五', risk: 'high', reqId: 'REQ-2024-0603', reqTitle: '订单流程优化', confirmed: 0, owner: '王五', desc: '订单表新增字段和索引' },
    { release: '2024.06.20 版本发布', file: 'user-center/auth-service/src/main/resources/sql/auth_schema.sql', type: 'modify', module: 'db', service: 'auth-service', repo: 'user-center', committer: '李四', risk: 'high', reqId: 'REQ-2024-0602', reqTitle: '登录安全加固', confirmed: 0, owner: '李四', desc: '认证表新增登录失败次数字段' },
    { release: '2024.06.20 版本发布', file: 'order-service/inventory-service/src/main/resources/sql/inventory_schema.sql', type: 'add', module: 'db', service: 'inventory-service', repo: 'order-service', committer: '赵六', risk: 'medium', reqId: 'REQ-2024-0604', reqTitle: '库存预占优化', confirmed: 1, owner: '赵六', desc: '新增库存预占表' },
    { release: '2024.06.20 版本发布', file: 'payment-gateway/payment-service/src/main/java/com/example/payment/RefundService.java', type: 'modify', module: 'payment-refund', service: 'payment-service', repo: 'payment-gateway', committer: '钱七', risk: 'medium', reqId: 'REQ-2024-0608', reqTitle: '退款流程优化', confirmed: 0, owner: '钱七', desc: '退款流程异步化改造' },
    { release: '2024.06.20 版本发布', file: 'data-platform/analytics-service/src/main/resources/sql/analytics_schema.sql', type: 'modify', module: 'db', service: 'analytics-service', repo: 'data-platform', committer: '孙八', risk: 'low', reqId: '', reqTitle: '', confirmed: 0, owner: '孙八', desc: '行为日志表增加索引' },
    { release: '2024.06.20 版本发布', file: 'user-center/user-service/src/main/java/com/example/user/UserProfileService.java', type: 'modify', module: 'user-profile', service: 'user-service', repo: 'user-center', committer: '周九', risk: 'low', reqId: 'REQ-2024-0609', reqTitle: '用户头像功能', confirmed: 1, owner: '周九', desc: '用户头像上传接口' },
    { release: '2024.06.20 版本发布', file: 'order-service/order-service/src/main/java/com/example/order/OrderQueryService.java', type: 'modify', module: 'order-query', service: 'order-service', repo: 'order-service', committer: '吴十', risk: 'low', reqId: 'REQ-2024-0610', reqTitle: '订单列表优化', confirmed: 1, owner: '吴十', desc: '订单列表分页性能优化' },
    { release: '2024.06.20 版本发布', file: 'payment-gateway/gateway-service/src/main/resources/application.yml', type: 'modify', module: 'config', service: 'gateway-service', repo: 'payment-gateway', committer: '钱七', risk: 'low', reqId: 'REQ-2024-0611', reqTitle: '网关配置调整', confirmed: 1, owner: '钱七', desc: '超时时间配置调整' },
    { release: '2024.06.20 版本发布', file: 'data-platform/report-service/src/main/java/com/example/report/ReportExportService.java', type: 'modify', module: 'report-export', service: 'report-service', repo: 'data-platform', committer: '孙八', risk: 'medium', reqId: 'REQ-2024-0612', reqTitle: '报表导出功能', confirmed: 0, owner: '孙八', desc: '新增Excel报表导出功能' },
    { release: '2024.06.20 版本发布', file: 'user-center/user-service/src/main/java/com/example/user/UserIntegrationTest.java', type: 'add', module: 'test', service: 'user-service', repo: 'user-center', committer: '张三', risk: 'low', reqId: 'REQ-2024-0601', reqTitle: '用户信息字段扩展', confirmed: 1, owner: '张三', desc: '新增集成测试用例' },
    { release: '2024.06.20 版本发布', file: 'order-service/order-service/src/main/java/com/example/order/OrderEventListener.java', type: 'modify', module: 'order-event', service: 'order-service', repo: 'order-service', committer: '王五', risk: 'medium', reqId: 'REQ-2024-0603', reqTitle: '订单流程优化', confirmed: 0, owner: '王五', desc: '订单事件监听器优化' },
    { release: '2024.06.15 紧急修复', file: 'payment-gateway/payment-service/src/main/java/com/example/payment/SecurityFilter.java', type: 'modify', module: 'security', service: 'payment-service', repo: 'payment-gateway', committer: '钱七', risk: 'high', reqId: 'REQ-2024-0515', reqTitle: '支付安全漏洞修复', confirmed: 1, owner: '钱七', desc: '支付回调签名验证修复' },
    { release: '2024.06.15 紧急修复', file: 'payment-gateway/gateway-service/src/main/java/com/example/gateway/RateLimiter.java', type: 'modify', module: 'gateway-limit', service: 'gateway-service', repo: 'payment-gateway', committer: '钱七', risk: 'medium', reqId: 'REQ-2024-0515', reqTitle: '支付安全漏洞修复', confirmed: 1, owner: '钱七', desc: '支付接口限流加固' },
    { release: '2024.06.10 版本发布', file: 'data-platform/report-service/src/main/java/com/example/report/ReportService.java', type: 'modify', module: 'report-core', service: 'report-service', repo: 'data-platform', committer: '孙八', risk: 'medium', reqId: 'REQ-2024-0501', reqTitle: '报表平台升级', confirmed: 1, owner: '孙八', desc: '报表查询性能优化' },
    { release: '2024.06.10 版本发布', file: 'data-platform/analytics-service/src/main/java/com/example/analytics/AnalyticsJob.java', type: 'modify', module: 'analytics-job', service: 'analytics-service', repo: 'data-platform', committer: '孙八', risk: 'low', reqId: 'REQ-2024-0502', reqTitle: '数据分析任务优化', confirmed: 1, owner: '孙八', desc: '分析任务调度优化' },
  ];

  const insertChangeStmt = dbModule.prepare('SELECT id FROM changes WHERE release_id = ? AND file_path = ?');
  const doInsertChange = dbModule.prepare(`INSERT INTO changes 
    (release_id, file_path, change_type, module, service_id, repository_id, committer, risk_level, requirement_id, requirement_title, confirmed, owner, description) 
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

  changes.forEach(c => {
    const rid = releaseIds[c.release];
    const existing = insertChangeStmt.get(rid, c.file);
    if (existing) {
      stepSkipped++;
    } else {
      try {
        doInsertChange.run(
          rid, c.file, c.type, c.module || null,
          serviceIds[c.service] || null, repoIds[c.repo] || null,
          c.committer || null, c.risk, c.reqId || null, c.reqTitle || null,
          c.confirmed ? 1 : 0, c.owner || null, c.desc || null
        );
        stepInserted++;
      } catch (err) {
        if (err.message && (err.message.includes('UNIQUE') || err.message.includes('unique'))) {
          const dupCheck = insertChangeStmt.get(rid, c.file);
          if (dupCheck) { stepSkipped++; return; }
        }
        console.error(`  ❌ 插入变更失败: ${c.file} - ${err.message}`);
        throw err;
      }
    }
  });
  totalInserted += stepInserted;
  totalSkipped += stepSkipped;
  console.log(`  完成: +${stepInserted} =${stepSkipped}, 变更 ${changes.length} 条就绪`);
  console.log('');

  dbModule.saveDb();

  console.log('='.repeat(60));
  console.log('种子数据导入完成 (幂等模式)');
  console.log('='.repeat(60));
  console.log(`本次新增: ${totalInserted} 条`);
  console.log(`本次跳过: ${totalSkipped} 条 (已存在)`);
  console.log('');
  console.log('数据规模保证:');
  console.log(`  仓库 (Repositories): ${repos.length} (>=4 ✓)`);
  console.log(`  服务 (Services): ${services.length} (>=8 ✓)`);
  console.log(`  API接口 (APIs): ${apis.length}`);
  console.log(`  数据库表 (DB Tables): ${tables.length}`);
  console.log(`  服务依赖 (Service Dependencies): ${serviceDeps.length}`);
  console.log(`  API调用 (API Calls): ${apiCalls.length}`);
  console.log(`  表引用 (Table References): ${tableRefs.length}`);
  console.log(`  发布单 (Releases): ${releases.length}`);
  console.log(`  变更 (Changes): ${changes.length} (>=20 ✓)`);
  console.log('');
  console.log('✅ 种子数据导入成功！重复运行此脚本不会产生重复数据。');
  console.log('='.repeat(60));
  } catch (err) {
    console.error('\n❌ 种子数据导入失败:', err.message);
    console.error(err.stack);
    dbModule.closeDb();
    setTimeout(() => process.exit(1), 50);
    return;
  }
  dbModule.closeDb();
  setTimeout(() => process.exit(0), 50);
}

main();
