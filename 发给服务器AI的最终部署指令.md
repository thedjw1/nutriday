# 发给服务器 AI 的最终部署指令

> 用途：把本地最新 `backend-example` 作为唯一代码来源，经 GitHub 同步到服务器，并完成 Node + MySQL + systemd 部署。
>
> 这份是发给服务器 AI 的模板，不是给本机执行的。

---

## 先改这 3 个占位符

把下面内容里的这几个值先替换掉：

- `<REPO_URL>`
- `<MYSQL_PASSWORD_NEW>`
- `<OPENAI_API_KEY>`

如果你已经有域名，也可以顺手确认：

- `nutriday.site`

---

## 发给服务器 AI 的整段指令

```text
不要再做重复的 ls 目录检查，不要循环确认目录。
如果某一步失败，停止往下编造成功状态，直接返回失败命令和原始报错。
每一步只返回真实命令输出摘要。

目标：
从 GitHub 最新版本部署 AI Health 后端到 /opt/ai-health-api/backend-example。
唯一代码来源是 GitHub 最新版，不要混用旧 clone、服务器手改文件或临时补文件。

仓库：
<REPO_URL>

已知要求：
1. 后端启动入口是 /opt/ai-health-api/backend-example/server.js
2. 实际运行时依赖这几个文件，必须同时存在：
   - server.js
   - server_complete.js
   - cloud_state.js
   - package.json
   - package-lock.json
   - sql/init_ai_health.sql
3. 环境变量只使用这些名字：
   - MYSQL_HOST
   - MYSQL_PORT
   - MYSQL_USER
   - MYSQL_PASSWORD
   - MYSQL_DATABASE
4. 不要使用 DB_HOST / DB_USER / DB_PASSWORD / DB_NAME
5. systemd 服务名使用 ai-health-api
6. 完成后必须验证：
   - node --check server.js
   - curl http://127.0.0.1:8080/api/version/latest
   - SHOW TABLES

按以下顺序执行：

第一阶段：准备目录和拉取代码
1. sudo mkdir -p /opt/ai-health-api
2. sudo chown -R $USER:$USER /opt/ai-health-api
3. 如果 /opt/ai-health-api/repo 不存在：
   - git clone <REPO_URL> /opt/ai-health-api/repo
4. 如果 /opt/ai-health-api/repo 已存在：
   - cd /opt/ai-health-api/repo
   - git pull origin main
5. 备份旧目录（如果存在）：
   - mv /opt/ai-health-api/backend-example /opt/ai-health-api/backend-example.bak-$(date +%Y%m%d-%H%M%S)
6. 复制最新后端：
   - cp -r /opt/ai-health-api/repo/backend-example /opt/ai-health-api/
7. 验证这几个文件都存在：
   - /opt/ai-health-api/backend-example/server.js
   - /opt/ai-health-api/backend-example/server_complete.js
   - /opt/ai-health-api/backend-example/cloud_state.js
   - /opt/ai-health-api/backend-example/package.json
   - /opt/ai-health-api/backend-example/package-lock.json
   - /opt/ai-health-api/backend-example/sql/init_ai_health.sql

第二阶段：安装依赖和语法检查
1. cd /opt/ai-health-api/backend-example
2. npm install
3. node --check server.js

第三阶段：写环境变量文件
1. sudo tee /etc/ai-health-api.env > /dev/null << 'EOF'
PORT=8080
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_USER=aihealth
MYSQL_PASSWORD=<MYSQL_PASSWORD_NEW>
MYSQL_DATABASE=ai_health
OPENAI_API_KEY=<OPENAI_API_KEY>
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-4o-mini
EOF
2. sudo chown root:root /etc/ai-health-api.env
3. sudo chmod 600 /etc/ai-health-api.env

第四阶段：验证数据库和导入建表 SQL
1. sudo tee /tmp/ai-health-mysql.cnf > /dev/null << 'EOF'
[client]
user=aihealth
password=<MYSQL_PASSWORD_NEW>
host=127.0.0.1
port=3306
database=ai_health
EOF
2. sudo chmod 600 /tmp/ai-health-mysql.cnf
3. mysql --defaults-extra-file=/tmp/ai-health-mysql.cnf -e "SELECT 'OK' AS status;"
4. mysql --defaults-extra-file=/tmp/ai-health-mysql.cnf -e "SHOW TABLES;"
5. 执行建表：
   - mysql --defaults-extra-file=/tmp/ai-health-mysql.cnf ai_health < /opt/ai-health-api/backend-example/sql/init_ai_health.sql
6. 再次执行：
   - mysql --defaults-extra-file=/tmp/ai-health-mysql.cnf -e "SHOW TABLES;"
7. 完成后删除：
   - rm -f /tmp/ai-health-mysql.cnf

第五阶段：配置 systemd
1. 先执行 which node，拿到 node 实际路径
2. 如果 /etc/systemd/system/ai-health-api.service 已存在，先备份一份带时间戳的副本
3. 创建 /etc/systemd/system/ai-health-api.service，内容如下，ExecStart 使用 which node 的实际路径：

[Unit]
Description=AI Health API
After=network.target mysql.service
Wants=mysql.service

[Service]
Type=simple
WorkingDirectory=/opt/ai-health-api/backend-example
EnvironmentFile=/etc/ai-health-api.env
ExecStart=<NODE实际路径> /opt/ai-health-api/backend-example/server.js
Restart=always
RestartSec=5
User=ubuntu
Group=ubuntu

[Install]
WantedBy=multi-user.target

4. 执行：
   - sudo systemctl daemon-reload
   - sudo systemctl enable ai-health-api
   - sudo systemctl restart ai-health-api
   - sudo systemctl status ai-health-api --no-pager
   - sudo journalctl -u ai-health-api -n 80 --no-pager

第六阶段：接口验证
1. curl -sS http://127.0.0.1:8080/api/version/latest
2. curl -sS -X POST http://127.0.0.1:8080/api/auth/register -H "Content-Type: application/json" -d "{\"email\":\"deploy-check@example.com\",\"password\":\"pass123456\",\"displayName\":\"Deploy Check\"}"
3. curl -sS -X POST http://127.0.0.1:8080/api/auth/login -H "Content-Type: application/json" -d "{\"email\":\"deploy-check@example.com\",\"password\":\"pass123456\"}"
4. 如果登录成功，返回 session.token
5. 再查数据库里是否已有：
   - users 表中的 deploy-check@example.com
   - auth_sessions 表中的最新 token 记录

最终只回报这些：
1. git clone / git pull 结果
2. 关键文件存在性检查结果
3. node --check server.js 结果
4. systemd 状态摘要
5. journalctl 最后几行关键日志
6. curl http://127.0.0.1:8080/api/version/latest 的实际 JSON
7. SHOW TABLES 的实际结果
8. 注册/登录测试是否成功
9. 如果失败，给出失败命令和原始报错
```

---

## 使用提醒

如果服务器 AI 又卡在下面这种状态：

- 一直重复 `ls -la`
- 输出总被截断
- 一直问“是否继续目录检查”

就不要继续那条任务了，直接结束，然后新开一个任务，整段发上面的模板。

---

## 本机配套动作

服务器部署通过后，本机再做这一步：

```powershell
D:\flutter\bin\flutter.bat run --dart-define=AI_HEALTH_API_BASE_URL=https://nutriday.site/api
```

不要在后端还没验证通过前就先测 App。
