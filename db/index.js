const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');

let db = null;
let dbPath = null;

async function initDb(dbFilePath) {
  dbPath = dbFilePath;
  const SQL = await initSqlJs();
  
  const dataDir = path.dirname(dbPath);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  if (fs.existsSync(dbPath)) {
    const fileBuffer = fs.readFileSync(dbPath);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }
  
  return db;
}

function saveDb() {
  if (db && dbPath) {
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(dbPath, buffer);
  }
}

function getDb() {
  if (!db) {
    throw new Error('Database not initialized. Call initDb first.');
  }
  return db;
}

function query(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const results = [];
  while (stmt.step()) {
    results.push(stmt.getAsObject());
  }
  stmt.free();
  return results;
}

function run(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  stmt.step();
  stmt.free();
  const lastId = query('SELECT last_insert_rowid() as id')[0].id;
  const changes = query('SELECT changes() as count')[0].count;
  return { lastInsertRowid: lastId, changes: changes };
}

function exec(sql) {
  db.exec(sql);
}

function prepare(sql) {
  const stmt = db.prepare(sql);
  return {
    run(...params) {
      stmt.bind(params);
      stmt.step();
      const lastId = query('SELECT last_insert_rowid() as id')[0].id;
      const changes = query('SELECT changes() as count')[0].count;
      stmt.reset();
      return { lastInsertRowid: lastId, changes: changes };
    },
    get(...params) {
      stmt.bind(params);
      let result = null;
      if (stmt.step()) {
        result = stmt.getAsObject();
      }
      stmt.reset();
      return result;
    },
    all(...params) {
      stmt.bind(params);
      const results = [];
      while (stmt.step()) {
        results.push(stmt.getAsObject());
      }
      stmt.reset();
      return results;
    },
    free() {
      stmt.free();
    }
  };
}

function closeDb() {
  if (db) {
    try {
      db.close();
    } catch (e) {
    }
    db = null;
  }
}

module.exports = {
  initDb,
  saveDb,
  getDb,
  query,
  run,
  exec,
  prepare,
  closeDb
};
