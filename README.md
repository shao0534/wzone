# 树洞网站 (wzone)

基于 **Qiankun 微前端**整合的个人门户网站，包含三个主菜单：**我的博客**、**我的项目**、**我的工具**。

## 一、总体架构

```
┌─────────────────────────────────────────────────────────────┐
│                    主应用 (main-app)                          │
│   Vite + React19 + React Router v7 + TanStack Query          │
│   + Zustand + TS + Less                                      │
│                                                              │
│   ┌─────────┐  ┌──────────────┐  ┌─────────┐                │
│   │ 我的博客 │  │   我的项目     │  │ 我的工具 │                │
│   └─────────┘  └──────┬───────┘  └─────────┘                │
│                       │ Qiankun (loadMicroApp)               │
│            ┌──────────┼──────────────┬───────────┐           │
│            ▼          ▼              ▼           │           │
│      ┌──────────┐ ┌──────────┐ ┌───────────┐    │           │
│      │ 摄像头监控 │ │ 管理后端  │ │  角色菜单  │    │           │
│      │ (cameras) │ │ (admin)  │ │  (React)  │◄───┘           │
│      └──────────┘ └──────────┘ └───────────┘                │
└──────────────────────────┬──────────────────────────────────┘
                           │ HTTP (REST)
                    ┌──────▼──────┐
                    │ 后端 server  │
                    │ Node + MySQL │
                    └─────────────┘
```

### 各子项目技术栈

| 项目                | 技术栈                                                                     | 说明                      |
| ----------------- | ----------------------------------------------------------------------- | ----------------------- |
| 主应用 main-app      | Vite + React19 + React Router v7 + TanStack Query + Zustand + TS + Less | 三个主菜单 + 角色菜单 + 微应用容器    |
| 摄像头监控 cameras-app | Vite + Vue3 + VueRouter + Pinia + TS + Less + Element Plus              | 万级摄像头列表 + 高德地图打点 + 视频播放 |
| 管理后端 admin-app    | webpack + Vue2 + VueRouter + Vuex + JS + Less + Element UI              | 摄像头增删改查、链接视频、上传大视频      |

## 二、目录结构

```
wzone/
├── package.json              # 根脚本(一键启动各服务)
├── server/                   # 后端服务
│   ├── sql/init.sql          # 建库建表 + 基础数据
│   └── src/
│       ├── app.js            # 入口
│       ├── config/db.js      # MySQL 连接池
│       ├── utils/response.js # 统一响应
│       ├── scripts/          # 初始化/种子脚本
│       └── routes/           # blog/tool/camera/role/application
├── main-app/                 # React 主应用
├── cameras-app/              # Vue3 摄像头监控
└── admin-app/                # Vue2 管理后端
```

## 三、数据模型 (Node + MySQL)

| 表                | 字段                                                                                                           |
| ---------------- | ------------------------------------------------------------------------------------------------------------ |
| blog 我的博客        | title, context, dateTime, id                                                                                 |
| tool 我的工具        | name, description, link, id, mdcode(安装使用说明)                                                                  |
| camera 摄像头       | cameraName, id, videoUrl, imgUrl, address, addressNum, longitude, latitude, state(在线/离线), startTime, endTime |
| role_button 角色按钮 | id, app, buttonKey, label, enabled                                                                           |
| application 申请   | id, app, buttonKey, buttonLabel, requestAction, reason, status, createdAt                                    |

## 四、快速开始

### 1. 初始化数据库

```bash
# 方式一: 直接执行 SQL
mysql -u root -p < server/sql/init.sql

# 方式二: 使用脚本
cd server && npm install && npm run init-db
```

### 2. 启动后端

```bash
cd server
npm install
# 可选: 配置环境变量(默认 127.0.0.1:3306, root/123456, 库名 wzone)
cp .env.example .env
npm run dev            # 端口 9000

# 可选: 造数据
npm run seed-cameras   # 10000 条北京摄像头
npm run seed-adjacent  # 同坐标多摄像头(相邻点位)
npm run gen-samples    # 生成模拟视频流样本(H264 / H265)
npm run seed-h265      # 造名称含 H265 的摄像头 + 补全视频源
```

### 3. 启动主应用

```bash
cd main-app
npm install
cp .env.example .env   # 配置 VITE_API_BASE / 微应用入口
npm run dev            # 端口 8000
```

### 4. 启动两个子应用

```bash
# 摄像头监控(Vue3)
cd cameras-app
npm install
cp .env.example .env   # 填入高德地图 VITE_AMAP_KEY
npm run dev            # 端口 8001

# 管理后端(Vue2)
cd admin-app
npm install
npm run dev            # 端口 8002
```

浏览器访问 <http://localhost:8000> 即可看到整合后的门户。

> **端口约定**: 主应用 8000 / 摄像头 8001 / 管理后端 8002 / 后端 9000。

## 五、Qiankun 整合要点

1. **加载方式**：主应用通过 `loadMicroApp` 按需加载子应用，入口在 `main-app/src/micro/qiankun.ts` 配置。两个子应用采用**串行加载**——cameras 先挂载完成，admin 再加载（`Projects/index.tsx` 用 `camerasMounted` 状态控制）。原因：`import-html-entry` 执行脚本时会把全局 `window.proxy` 覆盖为当前子应用的沙箱代理，若并发加载，admin 会覆盖 cameras 的 `window.proxy`，导致 cameras 的 `vite-plugin-qiankun` 生命周期桥接失效（报 single-spa code 31 生命周期超时）。
2. **样式隔离**：子应用开启 `experimentalStyleIsolation`(Scoped CSS 前缀隔离)，为各子应用样式自动加 `div[data-qiankun="应用名"]` 前缀，隔离 Element UI 与 Element Plus 同名 `.el-*` 样式冲突。不使用 `strictStyleIsolation`(Shadow DOM)——它会导致 `container.querySelector('#app')` 穿透不到 shadow root 返回 null，且 Element Plus/UI 的弹层(teleport 到 body)会被 Shadow DOM 吞掉丢失样式；子应用内的弹窗同时设置为**内联渲染**(`teleported: false` / 不挂 body)作为双保险。
3. **开发/生产说明**：开发阶段建议各子应用在自身端口(8001/8002)独立运行调试；`vite-plugin-qiankun` 的 `useDevMode` 支持 Vite 子应用独立运行。生产环境将子应用 `build` 产物托管后，把 `main-app/.env` 中的 `VITE_CAMERAS_ENTRY` / `VITE_ADMIN_ENTRY` 指向对应地址即可完整整合。Vue2(webpack)子应用通过 `output.library`(UMD) 导出生命周期，可直接在开发环境被主应用加载。
4. **通信管理**：主应用通过 `initGlobalState` 创建全局状态，将 `actions` 以 props 注入子应用；子应用通过 `actions.onGlobalStateChange` 监听广播并缓存到本地副本读取（qiankun 的 actions 只有 `onGlobalStateChange`/`setGlobalState`，**无 `getGlobalState`**）。
5. **路由隔离**：子应用在微应用环境下使用**内存路由**（Vue3 用 `createMemoryHistory`、Vue2 用 `abstract` 模式），不操作 URL。避免两个常驻挂载的子应用共用 `window.location.hash` 互相覆盖（如 admin 的 `/camera` 重定向会把 cameras 的 hash 改成 `#/camera`，导致其路由不匹配、列表空白）。

### 按钮权限流转(角色菜单)

```
角色菜单(主应用) ──更新按钮状态──► 后端 role_button ──广播──► 子应用(实时禁用/启用按钮)
        ▲                                                       │
        └──────── 审核通过后同步 ─── 申请 application ◄── 提交申请 ┘
```

## 六、API 清单 (前缀 /api)

| 方法                  | 路径                    | 说明                                   |
| ------------------- | --------------------- | ------------------------------------ |
| GET                 | /blog                 | 博客列表                                 |
| GET/POST/PUT/DELETE | /blog/:id             | 博客详情/新增/修改/删除                        |
| GET                 | /tool                 | 工具列表                                 |
| GET/POST/PUT/DELETE | /tool/:id             | 工具详情/新增/修改/删除                        |
| GET                 | /camera               | 摄像头分页查询(page/pageSize/keyword/state) |
| GET                 | /camera/all/positions | 全部坐标 + 数据版本号(地图打点, 首次全量)             |
| GET                 | /camera/changes       | 增量变更查询(`?since=版本号`), 返回变化摄像头的完整快照 |
| POST                | /camera/state/flip    | 手动触发随机切换 N 台状态(定时任务同款逻辑)             |
| GET                 | /camera/sync/status   | 同步中心运行状态(版本号/日志量/定时任务)               |
| GET/POST/PUT/DELETE | /camera/:id           | 摄像头详情/新增/修改/删除                       |
| POST                | /camera/link          | 链接摄像头生成视频                            |
| POST                | /camera/upload        | 上传大视频生成离线摄像头                         |
| GET                 | /stream/clock         | 服务端时钟(实时流同步基准)                       |
| GET                 | /stream/stats         | 流服务状态(时间轴/转码队列/样本数)                  |
| POST                | /stream/probe         | 批量网络测试(≤64): 可达性/延迟/编码              |
| GET                 | /stream/:id/probe     | 单路网络测试                               |
| GET                 | /stream/:id/play      | 单路取流(内部强制先做网络测试, 不通返回 412)          |
| POST                | /stream/batch         | 批量取流(≤64): 一次往返拿回全部播放描述              |
| GET                 | /stream/:id/position  | 实时流当前位置(播放中校正漂移用)                    |
| GET                 | /stream/:id/media     | 媒体数据, 支持 Range(206); H265 可自动返回转码后的 H264 |
| GET                 | /role                 | 按钮状态列表                               |
| PUT                 | /role/:id             | 更新按钮状态                               |
| GET                 | /application          | 申请列表                                 |
| POST                | /application          | 提交申请                                 |
| PUT                 | /application/:id      | 审核申请(通过/拒绝)                          |

统一响应格式：`{ code: 0, message, data }`，`code === 0` 表示成功。

### 摄像头数据的增量同步(30s 轮询 + 跨应用即时推送)

```
后端定时任务(每 30s)                       前端(每 30s)
随机挑 100 台 UPDATE state = 1 - state  ──►  GET /camera/changes?since=本地版本号
        │                                          │  只返回变化的摄像头快照(约 100 条)
        ├─ version +1(数据版本号)                  ▼
        ├─ changeLog 追加(上限 2 万条,          Web Worker: 只改这些 id, 重算受影响点位
        │   每条是点位最小字段快照)                 → 返回"真正变化"的摄像头 + 点位
        └─ 增删摄像头时 structure +1                ▼
                                          Store 按 id 原地替换(其余对象引用不变)
                                                   ▼
                                          列表(虚拟滚动) + 地图(仅重建变化点位的标记)
```

- **变更日志记的是完整字段快照**(`id/cameraName/longitude/latitude/state/type/address`)，不只 `state`：
  管理后台除了改状态，还会改名称、地址、类别、经纬度，只下发 `{id,state}` 会让这些修改永远同步不到监控端。
- **管理后台的任何改动都会推进版本号**：`PUT /camera/:id`、`/link`、`/:id/video`、`PATCH /:id/state` 在落库后统一
  走 `notifyCameras(ids)` 回查最新快照写日志；新增/删除则 `structure +1`，前端发现结构变化自动全量重建。
- **三条即时通道，不必死等 30s**：
  1. 管理后台保存/删除成功后通过 qiankun 全局状态广播 `cameraMutatedAt`，监控子应用（即使当前不可见）立即增量同步；
  2. 切回「摄像头监控」标签时先做一次增量对齐（版本/结构不符会自动降级为全量），而不是无脑重拉 1 万条；
  3. 监控窗口重新获得焦点/回到前台时补一次增量（覆盖"管理后台开在另一个浏览器窗口"的场景）。
- **列表和地图不是每 30s 全量刷新**：两者共用同一份 `positions`(10363 条)，只有首次、结构变化、版本失效时才全量拉取。
- **版本失效自动兜底**：服务重启(`since > version`)、变更日志被裁剪、增删摄像头(structure 变化)、Worker 已休眠，都会触发一次全量重建。
- **清洗全部在 Web Worker 中完成**：字段归一/脏数据剔除/重复 id 去重/坐标精度对齐/同坐标点位聚合/在线统计，主线程只做渲染；
  增量时 Worker 内部逐字段对比（含坐标迁移：摄像头换位置时从旧点位摘除、挂到新点位，旧点位空了返回 `removedSites`），没变化直接丢弃。
- **内存防控**：`AbortController` 中止在途请求、`clearInterval` 停轮询、解绑窗口焦点监听、`worker.terminate()` 销毁 Worker + 撤销 Blob URL；停止轮询(切菜单/关自动刷新)后空闲 30s 自动销毁，下次任务重新初始化并全量播种。

> 关于 qiankun 全局通信：`initGlobalState` 返回的 actions 实例在内部以「实例 id」为键存监听（`deps[id] = callback`），
> 同一实例上重复注册会**后者覆盖前者**。两个子应用共用一个 actions 时，后挂载的 admin 会把 cameras 的监听顶掉。
> 因此主应用给每个子应用单独 `createChannel()` 一个实例（共享同一份 globalState 与 deps 表），监听互不覆盖。

### 视频流: 实时/点播判定 + 网络测试 + 同步播放 + 批量平铺

**流类型由后端判定**（`streamService.modeOf`），前端不重复推导：

| 摄像头类别 | 流类型 | 取流要求 |
| --- | --- | --- |
| `type = 2` 人工上传视频生成 | **点播回放**(vod) | 直接播放视频文件，离线也可播 |
| `type = 1` 普通 / `type = 3` 车辆 | **实时流**(live) | 必须在线 + 网络测试通过 |

```
点击播放
   │
   ├─ 点播 ──────────────────────────► 取流 ──► 播放(从头)
   │
   └─ 实时流 ─► GET /stream/:id/probe(网络测试) ─┬─ 不通 ─► 提示原因(离线/源不可达), 不取流
                                                 └─ 通 ──► 取流 ──► 定位到实时位置播放
```

- **网络测试是真测**：本地源读首个 64KB 数据块并计时，远端源发 Range 请求取首包；返回 `latencyMs`、编码、时长。
- **同步播放**：所有实时流共享同一条时间轴（`LIVE_EPOCH`），后端在播放描述里直接给出 `positionMs`；
  前端按"拿流时刻 + 本地流逝时间"推算应播放位置，播放中每 5s 校正一次漂移（容差 600ms，按**环形最短距离**比较，避免跨循环点抖动）。
  样本画面里烧录了片内时间码，多路平铺时所有格子的时间码完全一致，可直接肉眼验证同步。
- **H265(HEVC)**：浏览器普遍不支持软解。先探测客户端能力（`MediaSource.isTypeSupported` / `canPlayType`），
  支持就直连原始 H265，不支持则由服务端 `ffmpeg` 转成 H264 并**按文件缓存**（`uploads/videos/cache`，同一文件只转一次，
  转码任务限 2 并发、按 `文件+体积+mtime` 去重）；等待超过 8s 返回 `preparing`，前端自动重试。
  H265 直连失败（部分环境声称支持但实际解不了）会自动回退到转码流，只回退一次。
- **批量平铺（≤64 路）**：列表选中摄像头后点「播放选中」，进入全屏 8×8 自适应网格。
  - **接口并发**：`POST /stream/batch` 一次拿回全部播放描述，避免 64 路各自"探活+取流"产生 128 次请求；
  - **拉流分波**：每波 8 路、间隔 250ms 放行，避免 64 个媒体请求同时抢占带宽与解码器；
  - **失败隔离**：单格失败显示原因并可单独重试，不拖垮整墙；H265 转码中的格子自动重试。
  - **内存防控**：退出时逐格 `video.pause()` + `removeAttribute('src')` + `load()` 触发解码器释放、销毁 hls 实例、
    清同步定时器、`AbortController` 中止在途请求；页面切后台时统一暂停，回来重新对齐。

### 模拟视频流样本

样本不入库（`uploads/videos/` 已被 git 忽略），首次运行需生成：

```bash
cd server
pnpm add @ffmpeg-installer/ffmpeg   # ffmpeg 二进制(走 npm 源, 无需访问 github)
npm run gen-samples                 # 生成 5 个 30s 片段(3 个 H264 + 2 个 H265, 带时间码)
npm run seed-h265                   # 造 40 台名称含 H265 的摄像头 + 给空视频源补模拟流
```

`npm run seed-h265` 会创建 24 台实时流 H265（`H265-实时-普通/车辆-xxx`）与 16 台人工上传点播 H265
（`H265-回放-人工上传-xxx`），并给所有 `videoUrl` 为空的摄像头补上 H264 样本（重复执行幂等）。

## 七、开发约定

- 代码简洁明了，中文注释明确，逻辑严谨准确。
- 前端统一 axios 拦截器解包响应；后端统一 `success/fail` 响应。
- 摄像头列表采用虚拟滚动 + 地图三级渲染(≤12 聚合气泡 / 13 海量点 / ≥14 DOM 点位)应对 10000 条数据。
