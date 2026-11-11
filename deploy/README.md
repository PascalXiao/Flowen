# 上线部署

一台云服务器，Docker Compose 跑全套服务，一个域名对外。Caddy 负责 HTTPS（自动申请和续期证书）、托管前端，把 `/api`、`/open-api` 转给 API，把 `/zero` 转给 zero-cache。Postgres、Temporal、zero-cache、API 都不对外暴露端口。

## 需要准备

- 一台 Linux 云服务器，2 核 4 GB 内存、40 GB 硬盘就够几十人试用；安全组放行 80 和 443 端口。
- 一个域名，把 A 记录指向服务器的公网 IP。用国内服务器的话，这个域名需要先备案。
- 服务器上安装 Docker（带 Compose 插件，版本 2.24 或更新）：`curl -fsSL https://get.docker.com | sh`

## 第一次部署

```sh
# 仓库是私有的，用有权限的账号或部署密钥克隆
git clone https://github.com/PascalXiao/Flowen.git /opt/feishu-project
cd /opt/feishu-project

cp deploy/.env.example deploy/.env
# 编辑 deploy/.env：填 DOMAIN，三个密钥分别用 openssl rand -hex 32 生成
vi deploy/.env

docker compose -f docker-compose.yml -f deploy/docker-compose.prod.yml --env-file deploy/.env --profile app up -d --build
```

第一次构建大约 5 到 10 分钟。完成后打开 `https://你的域名`，注册第一个账号，再新建空间。

后面的命令都要带同样的 `-f` 和 `--env-file` 参数，可以先设一个别名：

```sh
alias fp='docker compose -f docker-compose.yml -f deploy/docker-compose.prod.yml --env-file deploy/.env --profile app'
fp ps          # 看各服务状态
fp logs -f api # 看 API 日志
```

## 升级

```sh
cd /opt/feishu-project
git pull
fp up -d --build
```

数据库迁移由 `migrate` 服务在启动时自动执行。

## 备份和恢复

`deploy/backup.sh` 会把应用数据库（工作项、配置、事件）和附件备份到 `backups/<时间>/`，并保留最近 14 份。建议每天跑一次，并把 `backups/` 同步到对象存储：

```sh
crontab -e
# 加一行：每天凌晨 3 点备份
0 3 * * * cd /opt/feishu-project && sh deploy/backup.sh >> backups/backup.log 2>&1
```

恢复步骤（假设备份在 `backups/20261021-030000`）：

```sh
fp stop api worker relay zero-cache
fp exec -T postgres pg_restore -U feishu -d feishu --clean --if-exists < backups/20261021-030000/feishu.dump
fp exec -T api sh -c 'rm -rf /data/files && tar -C /data -xzf -' < backups/20261021-030000/files.tar.gz
# Zero 的本地副本按恢复后的数据重建
fp rm -sf zero-cache && docker volume rm feishu-project_zerodata
fp up -d
```

Temporal 的库没有备份。恢复后，备份时还在重试中的 Webhook 推送不会继续。

## 其他

- **查看 Temporal**：Temporal UI 只监听服务器本机。先在自己电脑上运行 `ssh -L 8080:localhost:8080 服务器`，再打开 http://localhost:8080 。
- **没有域名，先在内网试用**：在 `deploy/.env` 里设 `SITE_ADDRESS=:80`、`PUBLIC_URL=http://服务器IP`，`DOMAIN` 填服务器 IP。这时只走 HTTP，不要用于正式环境。
- **Webhook 推送到内网**：默认会拦截内网和本机地址。全内网部署时设 `WEBHOOK_ALLOW_PRIVATE=true`。
- **改数据库密码**：`POSTGRES_PASSWORD` 只在数据库第一次初始化时生效。之后要改，先执行 `fp exec postgres psql -U feishu -c "alter user feishu password '新密码'"`，再改 `deploy/.env`，然后执行 `fp up -d`。
