const path = require('path');
const dbModule = require('../db');

const dbPath = path.join(__dirname, '..', 'data', 'app.db');

async function main() {
  await dbModule.initDb(dbPath);
  
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
      name TEXT NOT NULL,
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
      description TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (release_id) REFERENCES releases(id) ON DELETE CASCADE,
      FOREIGN KEY (service_id) REFERENCES services(id),
      FOREIGN KEY (repository_id) REFERENCES repositories(id)
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

    CREATE INDEX IF NOT EXISTS idx_changes_release ON changes(release_id);
    CREATE INDEX IF NOT EXISTS idx_changes_service ON changes(service_id);
    CREATE INDEX IF NOT EXISTS idx_changes_risk ON changes(risk_level);
    CREATE INDEX IF NOT EXISTS idx_changes_confirmed ON changes(confirmed);
    CREATE INDEX IF NOT EXISTS idx_services_repo ON services(repository_id);
    CREATE INDEX IF NOT EXISTS idx_service_deps_from ON service_dependencies(from_service_id);
    CREATE INDEX IF NOT EXISTS idx_service_deps_to ON service_dependencies(to_service_id);
  `);

  dbModule.saveDb();
  console.log('Database initialized at:', dbPath);
}

main().catch(err => {
  console.error('Error initializing database:', err);
  process.exit(1);
});
