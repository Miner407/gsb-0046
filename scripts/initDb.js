const fs = require('fs');
const path = require('path');
const dbModule = require('../db');

const dbPath = path.join(__dirname, '..', 'data', 'app.db');
const shouldReset = process.argv.includes('--reset');

function dropAllTables() {
  const tables = [
    'table_references',
    'api_calls',
    'service_dependencies',
    'change_operations',
    'changes',
    'releases',
    'db_tables',
    'apis',
    'services',
    'repositories'
  ];

  console.log('  Dropping existing tables...');
  tables.forEach(table => {
    try {
      dbModule.run(`DROP TABLE IF EXISTS ${table}`);
      console.log(`    - ${table} dropped`);
    } catch (err) {
      console.warn(`    - Warning dropping ${table}: ${err.message}`);
    }
  });

  const indexes = [
    'idx_changes_release',
    'idx_changes_service',
    'idx_changes_risk',
    'idx_changes_confirmed',
    'idx_changes_rejected',
    'idx_services_repo',
    'idx_service_deps_from',
    'idx_service_deps_to',
    'idx_ops_change',
    'idx_ops_release',
    'idx_ops_type'
  ];

  console.log('  Dropping existing indexes...');
  indexes.forEach(idx => {
    try {
      dbModule.run(`DROP INDEX IF EXISTS ${idx}`);
    } catch (err) {
    }
  });
}

function createTables() {
  console.log('  Creating tables (IF NOT EXISTS)...');
  
  dbModule.exec(`
    CREATE TABLE IF NOT EXISTS repositories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      url TEXT,
      description TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS services (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      repository_id INTEGER,
      path_prefix TEXT,
      description TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (repository_id) REFERENCES repositories(id)
    );

    CREATE TABLE IF NOT EXISTS apis (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      method TEXT NOT NULL DEFAULT 'GET',
      path TEXT NOT NULL,
      service_id INTEGER,
      description TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (service_id) REFERENCES services(id)
    );

    CREATE TABLE IF NOT EXISTS db_tables (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      database_name TEXT DEFAULT 'default',
      service_id INTEGER,
      description TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (service_id) REFERENCES services(id)
    );

    CREATE TABLE IF NOT EXISTS releases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      version TEXT,
      status TEXT DEFAULT 'pending',
      planned_date DATE,
      description TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS changes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      release_id INTEGER NOT NULL,
      file_path TEXT NOT NULL,
      change_type TEXT DEFAULT 'modify',
      module TEXT,
      service_id INTEGER,
      repository_id INTEGER,
      committer TEXT,
      risk_level TEXT DEFAULT 'medium',
      requirement_id TEXT,
      requirement_title TEXT,
      confirmed INTEGER DEFAULT 0,
      confirmed_by TEXT,
      confirmed_at DATETIME,
      rejected INTEGER DEFAULT 0,
      rejected_by TEXT,
      rejected_at DATETIME,
      reject_reason TEXT,
      owner TEXT,
      description TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (release_id) REFERENCES releases(id) ON DELETE CASCADE,
      FOREIGN KEY (service_id) REFERENCES services(id),
      FOREIGN KEY (repository_id) REFERENCES repositories(id)
    );

    CREATE TABLE IF NOT EXISTS change_operations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      change_id INTEGER NOT NULL,
      release_id INTEGER,
      operation_type TEXT NOT NULL,
      operator TEXT,
      comment TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (change_id) REFERENCES changes(id) ON DELETE CASCADE,
      FOREIGN KEY (release_id) REFERENCES releases(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS service_dependencies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      from_service_id INTEGER NOT NULL,
      to_service_id INTEGER NOT NULL,
      dependency_type TEXT DEFAULT 'rpc',
      description TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (from_service_id) REFERENCES services(id) ON DELETE CASCADE,
      FOREIGN KEY (to_service_id) REFERENCES services(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS api_calls (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      from_api_id INTEGER,
      to_api_id INTEGER,
      from_service_id INTEGER,
      to_service_id INTEGER,
      call_type TEXT DEFAULT 'http',
      description TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (from_api_id) REFERENCES apis(id) ON DELETE SET NULL,
      FOREIGN KEY (to_api_id) REFERENCES apis(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS table_references (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      service_id INTEGER,
      table_id INTEGER NOT NULL,
      reference_type TEXT DEFAULT 'read',
      description TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE SET NULL,
      FOREIGN KEY (table_id) REFERENCES db_tables(id) ON DELETE CASCADE
    );
  `);

  const indexes = [
    { name: 'idx_changes_release', sql: 'CREATE INDEX IF NOT EXISTS idx_changes_release ON changes(release_id)' },
    { name: 'idx_changes_service', sql: 'CREATE INDEX IF NOT EXISTS idx_changes_service ON changes(service_id)' },
    { name: 'idx_changes_risk', sql: 'CREATE INDEX IF NOT EXISTS idx_changes_risk ON changes(risk_level)' },
    { name: 'idx_changes_confirmed', sql: 'CREATE INDEX IF NOT EXISTS idx_changes_confirmed ON changes(confirmed)' },
    { name: 'idx_changes_rejected', sql: 'CREATE INDEX IF NOT EXISTS idx_changes_rejected ON changes(rejected)' },
    { name: 'idx_services_repo', sql: 'CREATE INDEX IF NOT EXISTS idx_services_repo ON services(repository_id)' },
    { name: 'idx_service_deps_from', sql: 'CREATE INDEX IF NOT EXISTS idx_service_deps_from ON service_dependencies(from_service_id)' },
    { name: 'idx_service_deps_to', sql: 'CREATE INDEX IF NOT EXISTS idx_service_deps_to ON service_dependencies(to_service_id)' },
    { name: 'idx_ops_change', sql: 'CREATE INDEX IF NOT EXISTS idx_ops_change ON change_operations(change_id)' },
    { name: 'idx_ops_release', sql: 'CREATE INDEX IF NOT EXISTS idx_ops_release ON change_operations(release_id)' },
    { name: 'idx_ops_type', sql: 'CREATE INDEX IF NOT EXISTS idx_ops_type ON change_operations(operation_type)' }
  ];

  console.log('  Creating indexes (IF NOT EXISTS)...');
  let createdIdx = 0, skippedIdx = 0;
  indexes.forEach(idx => {
    try {
      dbModule.exec(idx.sql);
      createdIdx++;
    } catch (err) {
      skippedIdx++;
    }
  });
  console.log(`    - Indexes: ${createdIdx} ensured, ${skippedIdx} pre-existing`);
}

function getTableCounts() {
  const tables = ['repositories', 'services', 'apis', 'db_tables', 'releases', 'changes', 'service_dependencies', 'api_calls', 'table_references', 'change_operations'];
  const counts = {};
  tables.forEach(t => {
    try {
      counts[t] = dbModule.query(`SELECT COUNT(*) as count FROM ${t}`)[0].count;
    } catch (e) {
      counts[t] = 0;
    }
  });
  return counts;
}

async function main() {
  try {
  const dataDir = path.dirname(dbPath);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
    console.log(`Created data directory: ${dataDir}`);
  }

  if (shouldReset && fs.existsSync(dbPath)) {
    console.log('Reset mode: removing existing database file...');
    try {
      fs.unlinkSync(dbPath);
      console.log('  Database file removed successfully');
    } catch (err) {
      console.warn(`  Warning: could not remove DB file: ${err.message}`);
    }
  }

  console.log('='.repeat(60));
  console.log('多仓库发布变更影响分析平台 - 数据库初始化');
  console.log('='.repeat(60));
  console.log(`数据库路径: ${dbPath}`);
  console.log(`模式: ${shouldReset ? '重置(RESET)' : '常规(INIT)'}`);
  console.log('');

  await dbModule.initDb(dbPath);
  console.log('✅ 数据库连接已建立');
  console.log('');

  if (shouldReset) {
    console.log('执行重置流程...');
    dropAllTables();
    console.log('');
  } else {
    console.log('常规模式：保留现有数据，仅确保表结构存在');
    console.log('');
  }

  createTables();
  console.log('');

  const counts = getTableCounts();
  console.log('当前表数据量:');
  Object.entries(counts).forEach(([t, c]) => {
    console.log(`  - ${t}: ${c} 条`);
  });
  console.log('');

  dbModule.saveDb();
  console.log('='.repeat(60));
  console.log('✅ 数据库初始化完成');
  if (shouldReset) {
    console.log('   提示: 请运行 npm run seed 导入种子数据');
  }
  console.log('='.repeat(60));
  } catch (err) {
    console.error('\n❌ 数据库初始化失败:', err.message);
    console.error(err.stack);
    dbModule.closeDb();
    setTimeout(() => process.exit(1), 50);
    return;
  }
  dbModule.closeDb();
  setTimeout(() => process.exit(0), 50);
}

main();
