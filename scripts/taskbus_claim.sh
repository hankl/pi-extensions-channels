#!/bin/bash
# taskbus 待办任务检查和领取脚本
# 每10秒检查一次（crontab 每分钟触发，循环执行6次）
# 领取后自动下载任务文件到 tasks/ 目录

# 设置 PATH（crontab 环境缺少 /opt/homebrew/bin）
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LOG_FILE="/Users/hankl/team/dev/logs/taskbus_claim.log"

# 循环执行6次，每次间隔10秒
for i in 1 2 3 4 5 6; do
    # 检查是否有待办任务
    response=$(taskbus list -e daniel -s pending  2>/dev/null)
    
    # 提取 total 字段值
    total=$(echo "$response" | grep -o '"total": *[0-9]*' | grep -o '[0-9]*')
    
    if [ -n "$total" ] && [ "$total" -gt 0 ]; then
        echo "[$(date)] 发现待办任务 ($total 个)，正在领取..." | tee -a "$LOG_FILE"
        
        # 领取任务
        claim_result=$(taskbus claim -e daniel 2>/dev/null)
        echo "$claim_result" | tee -a "$LOG_FILE"
        
        # 提取任务 ID
        TASK_ID=$(echo "$claim_result" | grep -o '"id": *[0-9]*' | grep -o '[0-9]*')
        
        if [ -n "$TASK_ID" ]; then
            echo "[$(date)] 任务 ID: $TASK_ID，开始下载任务文件..." | tee -a "$LOG_FILE"
            
            # 调用下载脚本
            TASK_FILE=$("$SCRIPT_DIR/taskbus_download.sh" "$TASK_ID" 2>&1)
            
            if [ -f "$TASK_FILE" ]; then
                echo "[$(date)] 任务文件已下载: $TASK_FILE" | tee -a "$LOG_FILE"
                
                # 通知 daniel agent 有新任务
                echo "[$(date)] ===== 任务文件路径 =====" > /Users/hankl/team/dev/tasks/current_task.txt
                echo "$TASK_FILE" >> /Users/hankl/team/dev/tasks/current_task.txt
                echo "[$(date)] 任务书已准备好，请读取 $TASK_FILE 开始工作" | tee -a "$LOG_FILE"
            else
                echo "[$(date)] 下载失败: $TASK_FILE" | tee -a "$LOG_FILE"
            fi
        fi
        
        echo "[$(date)] 任务领取完成" | tee -a "$LOG_FILE"
    else
        echo "[$(date)] 没有待办任务 (total: ${total:-0})" >> "$LOG_FILE"
    fi
    
    # 最后一次不需要等待
    [ $i -lt 6 ] && sleep 10
done
