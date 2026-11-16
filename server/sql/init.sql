-- =============================================================
-- 树屋网站数据库初始化脚本
-- 执行方式: node src/scripts/init-db.js
-- 字符串内部禁止使用反引号 ` 以免 Windows 下触发语法错误
-- =============================================================

SET NAMES utf8mb4;

CREATE DATABASE IF NOT EXISTS shuwu DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE shuwu;

-- 我的博客表
CREATE TABLE IF NOT EXISTS blog (
  id        INT PRIMARY KEY AUTO_INCREMENT COMMENT '主键',
  title     VARCHAR(255) NOT NULL COMMENT '标题',
  context   MEDIUMTEXT   NOT NULL COMMENT '正文内容(Markdown)',
  dateTime  DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '发布时间'
) ENGINE=InnoDB COMMENT='我的博客';

-- 我的工具表
CREATE TABLE IF NOT EXISTS tool (
  id          INT PRIMARY KEY AUTO_INCREMENT COMMENT '主键',
  name        VARCHAR(255) NOT NULL COMMENT '工具名称',
  description TEXT COMMENT '工具描述',
  link        VARCHAR(500) COMMENT '工具链接',
  mdcode      MEDIUMTEXT COMMENT '使用说明'
) ENGINE=InnoDB COMMENT='我的工具';

-- 摄像头表
CREATE TABLE IF NOT EXISTS camera (
  id          INT PRIMARY KEY AUTO_INCREMENT COMMENT '主键',
  cameraName  VARCHAR(255) NOT NULL COMMENT '摄像头名称',
  videoUrl    VARCHAR(500) COMMENT '视频地址',
  imgUrl      VARCHAR(500) COMMENT '封面图',
  address     VARCHAR(255) COMMENT '地址',
  addressNum  VARCHAR(100) COMMENT '地址编号',
  longitude   DECIMAL(10,6) COMMENT '经度',
  latitude    DECIMAL(10,6) COMMENT '纬度',
  state       TINYINT DEFAULT 1 COMMENT '1在线 0离线',
  type        TINYINT NOT NULL DEFAULT 1 COMMENT '摄像头类型 1普通 2人工上传 3车辆',
  startTime   DATETIME COMMENT '开始时间',
  endTime     DATETIME COMMENT '结束时间'
) ENGINE=InnoDB COMMENT='摄像头';

-- 角色按钮状态表(按角色分别配置: 同一按钮可为管理员与普通用户设置不同可用状态)
CREATE TABLE IF NOT EXISTS role_button (
  id        INT PRIMARY KEY AUTO_INCREMENT COMMENT '主键',
  app       VARCHAR(50)  NOT NULL COMMENT 'cameras / admin',
  buttonKey VARCHAR(100) NOT NULL COMMENT '按钮标识',
  role      TINYINT NOT NULL DEFAULT 0 COMMENT '0普通用户 1管理员',
  label     VARCHAR(100) NOT NULL COMMENT '按钮名称',
  enabled   TINYINT DEFAULT 1 COMMENT '1可用 0禁用',
  UNIQUE KEY uk_app_key_role (app, buttonKey, role)
) ENGINE=InnoDB COMMENT='角色按钮状态';

-- 按钮状态修改申请表(role 记录申请者角色, 审核通过只改该角色的配置)
CREATE TABLE IF NOT EXISTS application (
  id            INT PRIMARY KEY AUTO_INCREMENT COMMENT '主键',
  app           VARCHAR(50)  NOT NULL COMMENT 'cameras / admin',
  buttonKey     VARCHAR(100) NOT NULL COMMENT '按钮标识',
  buttonLabel   VARCHAR(100) COMMENT '按钮名称',
  applicant     VARCHAR(50)  DEFAULT '' COMMENT '申请人(服务端从 token 解出)',
  role          TINYINT NOT NULL DEFAULT 0 COMMENT '申请者角色 0普通用户 1管理员',
  requestAction TINYINT DEFAULT 1 COMMENT '1启用 0禁用',
  reason        VARCHAR(500) COMMENT '申请理由',
  status        TINYINT DEFAULT 0 COMMENT '0待审核 1通过 2拒绝',
  createdAt     DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '申请时间'
) ENGINE=InnoDB COMMENT='按钮修改申请';

-- 系统用户表(登录用)
-- pwd 存储 scrypt 加盐哈希, 格式为 scrypt$<salt>$<hash>, 绝不存明文
-- role: 0 普通用户, 1 管理员
CREATE TABLE IF NOT EXISTS sys_user (
  id        INT PRIMARY KEY AUTO_INCREMENT COMMENT '主键',
  name      VARCHAR(64)  NOT NULL COMMENT '用户名',
  pwd       VARCHAR(255) NOT NULL COMMENT '密码哈希',
  role      TINYINT NOT NULL DEFAULT 0 COMMENT '0普通用户 1管理员',
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  UNIQUE KEY uk_name (name)
) ENGINE=InnoDB COMMENT='系统用户';

-- =============================================================
-- 初始化数据 (幂等)
-- =============================================================

DELETE FROM blog;
INSERT INTO blog (title, context, dateTime) VALUES
('高可用监控系统架构设计', '本文总结监控系统项目架构经验。\n\n核心要点：\n1. 四层架构: 采集-接入-存储-展示, 解耦采集层与接入层;\n2. 统一网关接入, 支持多协议转换;\n3. 分布式消息队列削峰填谷, 保证万级设备稳定;\n4. 地图打点采用聚合策略, 避免海量标记卡顿。', NOW()),
('微前端落地方案 Qiankun 实践', '树屋项目使用 Qiankun 整合 React 主应用与 Vue 子应用。\n\n关键经验:\n1. initGlobalState 实现跨应用通信;\n2. experimentalStyleIsolation 避免 Element UI / Plus 样式污染;\n3. 子应用 hash 路由避免与主应用 history 冲突。', NOW());

DELETE FROM tool;
INSERT INTO tool (name, description, link, mdcode) VALUES
('JSON 格式化工具', '在线 JSON 格式化、校验与压缩', 'http://localhost:9000/tools/json-format', '# 安装\n    npm i -g json-format\n\n# 使用\n    json-format file.json'),
('Base64 编解码工具', '文本与 Base64 互转', 'http://localhost:9000/tools/base64', '# 使用\n输入文本即可实时转换。');

-- 按钮权限种子: 每个按钮 × 两种角色各一行
-- 默认策略: 管理员全部可用; 普通用户仅可查看视频, 操作类(改状态/上传/增删改)全部禁用,
-- 需通过「角色菜单 -> 申请审核」流程为对应角色开启
INSERT INTO role_button (app, buttonKey, role, label, enabled) VALUES
('cameras', 'viewVideo',   1, '查看视频',     1),
('cameras', 'linkVideo',   1, '链接视频',     1),
('cameras', 'uploadVideo', 1, '上传视频',     1),
('cameras', 'changeState', 1, '修改状态',     1),
('admin',   'add',         1, '新增摄像头',   1),
('admin',   'edit',        1, '修改摄像头',   1),
('admin',   'delete',      1, '删除摄像头',   1),
('admin',   'linkVideo',   1, '链接生成视频', 1),
('admin',   'uploadVideo', 1, '上传视频',     1),
('cameras', 'viewVideo',   0, '查看视频',     1),
('cameras', 'linkVideo',   0, '链接视频',     0),
('cameras', 'uploadVideo', 0, '上传视频',     0),
('cameras', 'changeState', 0, '修改状态',     0),
('admin',   'add',         0, '新增摄像头',   0),
('admin',   'edit',        0, '修改摄像头',   0),
('admin',   'delete',      0, '删除摄像头',   0),
('admin',   'linkVideo',   0, '链接生成视频', 0),
('admin',   'uploadVideo', 0, '上传视频',     0)
ON DUPLICATE KEY UPDATE label = VALUES(label);