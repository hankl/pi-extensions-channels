#!/bin/bash
# daniel_read_task.sh - Daniel agent 读取当前任务
# 直接运行此脚本读取最新任务书

TASK_FILE="/Users/hankl/team/dev/tasks/current_task.txt"
TASKS_DIR="/Users/hankl/team/dev/tasks"

if [ ! -f "$TASK_FILE" ]; then
    echo "❌ 没有找到任务文件"
    echo "请先运行 scripts/taskbus_claim.sh 领取任务"
    exit 1
fi

# 读取任务文件路径
TASK_PATH=$(tail -1 "$TASK_FILE")

if [ ! -f "$TASK_PATH" ]; then
    echo "❌ 任务文件不存在: $TASK_PATH"
    exit 1
fi

echo "📋 任务书内容:"
echo "========================================"
cat "$TASK_PATH"
echo "========================================"
echo ""
echo "📁 任务文件路径: $TASK_PATH"
echo ""
echo "💡 Daniel，开始工作吧！"
