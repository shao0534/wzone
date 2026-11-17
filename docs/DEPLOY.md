# 树屋项目打包部署指南

单域名同源部署:主应用 + 两个 qiankun 子应用 + Node 后端,全部收在一个 Nginx/Caddy 入口下。
同源的好处:登录 token 直接共享(localStorage)、SSE/接口零跨域、无 CORS 配置负担。

## 一、整体架构

```
浏览器
  │
  ▼  https://your-domain.com
┌─────────────────────────────────────────────┐
│ Nginx 或 Caddy (80/443)                     │
│  /                → 主应用静态文件 (dist)     │
│  /apps/cameras/   → 摄像头监控 dist          │
│  /apps/admin/     → 管理后端 dist            │
│  /api/  /uploads/ → 反代 Node 服务 (127.0.0.1:9000)
└─────────────────────────────────────────────┘
  │
  ▼
Node (server/) → MySQL (shuwu 库) + uploads/ 目录
```

## 二、本地打包(开发机上执行)

```bash
# 主应用
cd main-app && npm ci && npm run build        # 产物: main-app/dist/

# 摄像头监控子应用
cd cameras-app && npm ci && npm run build     # 产物: cameras-app/dist/

# 管理后端子应用
cd admin-app && npm ci && npm run build       # 产物: admin-app/dist/
```

构建要点(已配置好,无需额外操作):
- 生产环境自动读取 `.env.production`:API 走相对路径 `/api`,子应用入口为 `/apps/cameras/`、`/apps/admin/`
- cameras 资源前缀 `/apps/cameras/`、admin 资源前缀 `/apps/admin/`(webpack 通过 `--mode production` 判定)
- 高德地图 Key 在 `cameras-app/.env`(git 忽略),构建时自动注入

## 三、服务器准备

- 系统:任意 Linux(示例用 Ubuntu/Debian 路径)
- Node.js ≥ 20(`node -v` 确认)
- MySQL 8.x
- Nginx 或 Caddy(二选一,配置分别在 deploy/nginx.conf 与 deploy/Caddyfile)
- npm 包 `@ffmpeg-installer/ffmpeg` 会自动带 ffmpeg 二进制,无需单独安装

目录规划(前端在 /home/lighthouse/web,后端在 /home/lighthouse/server):

```
/home/lighthouse/
├── web/shuwu/
│   ├── main/       # 主应用 dist
│   ├── cameras/    # 摄像头监控 dist
│   └── admin/      # 管理后端 dist
└── server/shuwu/   # 后端代码 + uploads/ 目录
```

## 四、部署后端

```bash
# 1. 上传代码(或 git clone 后注意:仓库中 DB 密码已脱敏为 xxxxxxx,必须用环境变量传入真实密码)
mkdir -p /home/lighthouse/server/shuwu
rsync -av --exclude node_modules --exclude dist --exclude .keys --exclude uploads server/ lighthouse@server:/home/lighthouse/server/shuwu/

cd /home/lighthouse/server/shuwu && npm ci --omit=dev

# 3. 初始化数据库(仅首次)
mysql -u root -p < sql/init.sql                    # 建库建表(库名 shuwu)
mysql -u root -p -e "CREATE USER IF NOT EXISTS 'wzone'@'localhost' IDENTIFIED BY '你的数据库密码'; GRANT ALL ON shuwu.* TO 'wzone'@'localhost';"

# 4. 启动(在 /home/lighthouse/server/shuwu 目录下执行;DB_PASSWORD 必传;初始用户 root01/test01 在启动时自动创建,初始密码 shuwu,登录后请修改)
npm i -g pm2
DB_PASSWORD='你的数据库密码' pm2 start src/app.js --name shuwu-server
pm2 save && pm2 startup    # 开机自启
```

说明:
- RSA 密钥对(`server/.keys/`)与 token 签名密钥**首次启动自动生成**,无需从本地拷贝(服务器本地生成更安全)
- `uploads/` 目录自动创建(位于 /home/lighthouse/server/shuwu/uploads),存放上传的视频/图片
- 摄像头状态模拟、视频转码预热等服务启动后自动运行

## 五、部署前端静态文件

```bash
# 本机执行:上传三个 dist 到服务器对应目录
rsync -av main-app/dist/     user@server:/home/lighthouse/web/shuwu/main/
rsync -av cameras-app/dist/  user@server:/home/lighthouse/web/shuwu/cameras/
rsync -av admin-app/dist/    user@server:/home/lighthouse/web/shuwu/admin/
```

## 六、反向代理配置(Nginx 或 Caddy 二选一)

### 方式 A: Nginx

参考 `deploy/nginx.conf`(完整可抄),要点:

```nginx
server {
    listen 80;
    server_name your-domain.com;
    client_max_body_size 50m;              # 视频上传大小上限,与后端限制一致

    # 主应用: history 路由 fallback
    location / {
        root /home/lighthouse/web/shuwu/main;
        try_files $uri /index.html;
    }

    # 子应用: 按路径 alias,各自 fallback 到自己的 index.html
    location /apps/cameras/ {
        alias /home/lighthouse/web/shuwu/cameras/;
        try_files $uri /apps/cameras/index.html;
    }
    location /apps/admin/ {
        alias /home/lighthouse/web/shuwu/admin/;
        try_files $uri /apps/admin/index.html;
    }

    # 后端 API + 上传文件
    location /api/ {
        proxy_pass http://127.0.0.1:9000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        # SSE 实时通知(/api/notification/stream)必须关闭缓冲,否则事件会被攒着不推
        proxy_buffering off;
        proxy_read_timeout 3600s;
    }
    location /uploads/ {
        proxy_pass http://127.0.0.1:9000;
        proxy_set_header Host $host;
    }
}
```

```bash
sudo nginx -t && sudo systemctl reload nginx
```

HTTPS(可选但推荐):用 certbot 一条命令:
```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
```

### 方式 B: Caddy

参考 `deploy/Caddyfile`(完整可抄),直接放到 /etc/caddy/Caddyfile:

```bash
sudo cp deploy/Caddyfile /etc/caddy/Caddyfile
# 修改第一行域名;纯 IP 访问改成 ":80"
sudo caddy fmt --overwrite /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

要点(与 Nginx 等价):
- `flush_interval -1` 对应 Nginx 的 `proxy_buffering off`,SSE 必配,否则实时通知不推
- Caddy 反代默认无读超时,SSE 长连接不会被空闲断开,无需像 Nginx 一样配 `proxy_read_timeout`
- `request_body max_size 50MB` 对应 `client_max_body_size 50m`
- 域名方式 HTTPS 证书全自动申请续期,无需 certbot
- 若 Caddy(caddy 用户)读不了 /home/lighthouse,执行 `chmod o+x /home/lighthouse`

## 七、验证清单

| 检查项 | 方法 |
|---|---|
| 后端存活 | `curl http://127.0.0.1:9000/api/auth/public-key` 返回 JSON |
| 主应用 | 打开 `https://your-domain.com` 出现登录页(scenery.jpg 背景) |
| 登录 | root01 / shuwu(首次密码,建议尽快改) |
| 子应用加载 | 我的项目 → 摄像头监控 / 管理后端 正常渲染(F12 无 404) |
| SSE 实时 | A 浏览器提交申请,B 浏览器管理员铃铛 1s 内出现角标 |
| 视频上传/播放 | 上传一个视频并播放(`/uploads/` 可访问) |
| pm2 | `pm2 list` 状态 online,`pm2 logs shuwu-server` 无报错 |

## 八、常见问题

- **登录 401/公钥获取失败** → 反代的 `/api/` 未生效,`curl` 服务器本机 9000 排查后端,再看 Nginx/Caddy 日志
- **子应用白屏/F12 一堆 404** → 静态资源前缀与部署路径不一致:确认构建时是 `npm run build`(而非 dev),Nginx alias 路径与 `/apps/*` 完全对应
- **铃铛不实时** → 反代缺 `proxy_buffering off`(Nginx)/ `flush_interval -1`(Caddy),SSE 被缓冲;还会看到请求 pending 很久才一起返回
- **上传视频报 413** → `client_max_body_size` 小于文件大小
- **数据库连接失败** → `pm2 env shuwu-server | grep DB_PASSWORD`,环境变量没带上就 `pm2 delete` 后带变量重启
