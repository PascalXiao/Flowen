#!/bin/sh
# 备份数据库和附件到 backups/<时间>/，保留最近 14 份。在仓库根目录运行，建议每天用 cron 跑一次：
#   0 3 * * * cd /opt/flowen && sh deploy/backup.sh >> backups/backup.log 2>&1
set -eu
cd "$(dirname "$0")/.."
compose="docker compose -f docker-compose.yml -f deploy/docker-compose.prod.yml --env-file deploy/.env --profile app"
dir="backups/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$dir"

# 应用库（工作项、配置、事件）；Zero 和 Temporal 的库可以重建，不备份
$compose exec -T postgres pg_dump -U flowen -Fc flowen > "$dir/flowen.dump"
# 附件
$compose exec -T api tar -C /data -czf - files > "$dir/files.tar.gz"

ls -1d backups/*/ | sort | head -n -14 | xargs -r rm -rf
echo "备份完成：$dir"
