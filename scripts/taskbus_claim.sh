#!/bin/bash
# taskbus 待办任务检查和领取脚本
# 每10秒检查一次（crontab 每分钟触发，循环执行6次）

# 设置 PATH（crontab 环境缺少 /opt/homebrew/bin）
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

# 循环执行6次，每次间隔10秒
for i in 1 2 3 4 5 6; do
    # 检查是否有待办任务
    response=$(taskbus list -e daniel -s pending  2>/dev/null)
    
    # 提取 total 字段值
    total=$(echo "$response" | grep -o '"total": *[0-9]*' | grep -o '[0-9]*')
    
    if [ -n "$total" ] && [ "$total" -gt 0 ]; then
        echo "[$(date)] 发现待办任务 ($total 个)，正在领取..."
        taskbus claim -e daniel
        echo "[$(date)] 任务领取完成"
    else
        echo "[$(date)] 没有待办任务 (total: ${total:-0})"
    fi
    
    # 最后一次不需要等待
    [ $i -lt 6 ] && sleep 10
done
