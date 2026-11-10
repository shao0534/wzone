// MySQL 连接池配置
// 支持通过环境变量覆盖(见 server/.env.example)
const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'dashu',
  password: process.env.DB_PASSWORD || 'xxxxxxx',
  database: process.env.DB_NAME || 'wzone',
  waitForConnections: true,
  connectionLimit: 10,
  charset: 'utf8mb4',
});

module.exports = pool;
