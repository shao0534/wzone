// 数据库初始化脚本: 执行 server/sql/init.sql
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

async function run() {
  // scripts/ 在 src/scripts/, SQL 文件在 server/sql/, 所以要往上两级
  const sql = fs.readFileSync(path.join(__dirname, '../../sql/init.sql'), 'utf8');
  // 首次连接不指定库, 以便创建数据库
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'dashu',
    password: process.env.DB_PASSWORD || 'xxxxxxx',
    multipleStatements: true,
  });
  await conn.query(sql);
  await conn.end();
  console.log('[init-db] 数据库初始化完成');
  process.exit(0);
}

run().catch((e) => { console.error('[init-db] 失败:', e.message); process.exit(1); });