const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.join(__dirname, '..');
const SOURCE_DIRS = ['routes', 'services', 'db', 'scripts', 'tests'];
const ROOT_FILES = ['server.js'];
const EXCLUDE_DIRS = ['node_modules', '.git', 'data', 'reports', 'cache', '.temp', 'tmp', 'temp', 'coverage', '.nyc_output'];
const EXCLUDE_FILES = ['package.json', 'package-lock.json'];

let errorCount = 0;
let fileCount = 0;
const errorDetails = [];

function shouldExclude(dirName) {
  return EXCLUDE_DIRS.includes(dirName);
}

function isSourceFile(filePath) {
  if (!filePath.endsWith('.js')) return false;
  const fileName = path.basename(filePath);
  if (EXCLUDE_FILES.includes(fileName)) return false;
  return true;
}

function checkSyntax(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    if (filePath.endsWith('.json')) {
      JSON.parse(content);
    } else {
      new Function(content);
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function walkDirectory(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    console.warn(`  ⚠️  无法读取目录: ${path.relative(PROJECT_ROOT, dir)} - ${err.message}`);
    return;
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!shouldExclude(entry.name)) {
        walkDirectory(fullPath);
      }
    } else if (entry.isFile()) {
      if (isSourceFile(fullPath)) {
        fileCount++;
        const relativePath = path.relative(PROJECT_ROOT, fullPath);
        const result = checkSyntax(fullPath);
        if (result.ok) {
          process.stdout.write(`  ✓ ${relativePath}\n`);
        } else {
          errorCount++;
          errorDetails.push({ file: relativePath, error: result.error });
          process.stdout.write(`  ✗ ${relativePath}\n`);
          process.stdout.write(`      ${result.error}\n`);
        }
      }
    }
  }
}

console.log('='.repeat(60));
console.log('多仓库发布变更影响分析平台 - 源码语法检查');
console.log('='.repeat(60));
console.log(`项目根目录: ${PROJECT_ROOT}`);
console.log(`检查目录: ${SOURCE_DIRS.join(', ')}`);
console.log(`根目录文件: ${ROOT_FILES.join(', ')}`);
console.log(`排除目录: ${EXCLUDE_DIRS.join(', ')}`);
console.log(`排除文件: ${EXCLUDE_FILES.join(', ')}`);
console.log('注意: 不会递归扫描 node_modules 等排除目录');
console.log('');

for (const dirName of SOURCE_DIRS) {
  const dirPath = path.join(PROJECT_ROOT, dirName);
  if (fs.existsSync(dirPath)) {
    console.log(`📁 扫描目录: ${dirName}/`);
    walkDirectory(dirPath);
    console.log('');
  } else {
    console.log(`⚠️  目录不存在，跳过: ${dirName}/`);
    console.log('');
  }
}

console.log('📄 检查根目录源码文件:');
for (const fileName of ROOT_FILES) {
  const filePath = path.join(PROJECT_ROOT, fileName);
  if (fs.existsSync(filePath) && !fileName.endsWith('.json')) {
    if (isSourceFile(filePath)) {
      fileCount++;
      const relativePath = fileName;
      const result = checkSyntax(filePath);
      if (result.ok) {
        process.stdout.write(`  ✓ ${relativePath}\n`);
      } else {
        errorCount++;
        errorDetails.push({ file: relativePath, error: result.error });
        process.stdout.write(`  ✗ ${relativePath}\n`);
        process.stdout.write(`      ${result.error}\n`);
      }
    }
  }
}
console.log('');

console.log('='.repeat(60));
console.log('检查结果汇总');
console.log('='.repeat(60));
console.log(`检查文件数: ${fileCount}`);
console.log(`通过文件数: ${fileCount - errorCount}`);
console.log(`错误文件数: ${errorCount}`);
console.log('');

if (errorCount > 0) {
  console.log('❌ 语法错误详情:');
  errorDetails.forEach((e, i) => {
    console.log(`  ${i + 1}. ${e.file}`);
    console.log(`     ${e.error}`);
  });
  console.log('');
  console.log(`❌ 发现 ${errorCount} 个语法错误，请修复后重试`);
  process.exit(1);
} else {
  console.log(`✅ 全部 ${fileCount} 个文件语法检查通过！`);
  process.exit(0);
}
