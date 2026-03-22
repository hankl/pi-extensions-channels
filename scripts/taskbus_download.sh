#!/bin/bash
# taskbus_download.sh - 下载任务文件
# 用法: ./taskbus_download.sh <task_id>
# 输出: 下载的文件路径，失败返回空

# 设置 PATH
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

TASK_ID="$1"
TASKS_DIR="/Users/hankl/team/dev/tasks"

if [ -z "$TASK_ID" ]; then
    echo "用法: $0 <task_id>" >&2
    exit 1
fi

# 获取任务详情
response=$(taskbus get "$TASK_ID" 2>/dev/null)

if [ $? -ne 0 ] || [ -z "$response" ]; then
    echo "[$(date)] 获取任务 $TASK_ID 详情失败" >&2
    exit 1
fi

# 提取 fileUrl
FILE_URL=$(echo "$response" | grep -o '"fileUrl": *"[^"]*"' | sed 's/"fileUrl": *"//;s/"$//')

if [ -z "$FILE_URL" ]; then
    echo "[$(date)] 任务 $TASK_ID 没有 fileUrl" >&2
    exit 1
fi

# 提取任务名称作为文件名
TASK_NAME=$(echo "$response" | grep -o '"name": *"[^"]*"' | head -1 | sed 's/"name": *"//;s/"$//')
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
FILENAME="${TASK_NAME:-task_${TASK_ID}}_${TIMESTAMP}.md"
OUTPUT_FILE="$TASKS_DIR/$FILENAME"

# 下载文件
echo "[$(date)] 开始下载任务 $TASK_ID 的文件..."
echo "[$(date)] URL: ${FILE_URL:0:80}..."

if curl -L -o "$OUTPUT_FILE" "$FILE_URL" 2>/dev/null; then
    echo "[$(date)] 下载成功: $OUTPUT_FILE"
    echo "$OUTPUT_FILE"
    exit 0
else
    echo "[$(date)] 下载失败" >&2
    rm -f "$OUTPUT_FILE"
    exit 1
fi
