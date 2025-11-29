"""
消息处理模块
处理 Claude Code 历史记录，合并连续的用户消息，确保符合 Amazon Q 格式要求
"""
import logging
from typing import List, Dict, Any

logger = logging.getLogger(__name__)


def merge_user_messages(user_messages: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    合并多个 userInputMessage 的内容

    Args:
        user_messages: userInputMessage 列表

    Returns:
        合并后的 userInputMessage
    """
    if not user_messages:
        return {}

    # 提取所有内容
    all_contents = []
    base_context = None
    base_origin = None
    base_model = None

    for msg in user_messages:
        content = msg.get("content", "")

        # 保留第一个消息的上下文信息
        if base_context is None:
            base_context = msg.get("userInputMessageContext", {})

        # 保留第一个消息的 origin
        if base_origin is None:
            base_origin = msg.get("origin", "CLI")

        # 保留第一个消息的 modelId
        if base_model is None and "modelId" in msg:
            base_model = msg["modelId"]

        # 添加内容（保留所有内容，包括 system-reminder）
        if content:
            all_contents.append(content)

    # 合并内容，使用双换行分隔
    merged_content = "\n\n".join(all_contents)

    # 构建合并后的消息
    merged_msg = {
        "content": merged_content,
        "userInputMessageContext": base_context or {},
        "origin": base_origin or "CLI"
    }

    # 如果原始消息有 modelId，也保留
    if base_model:
        merged_msg["modelId"] = base_model

    return merged_msg


def process_claude_history_for_amazonq(history: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    处理 Claude Code 历史记录，使其符合 Amazon Q 要求

    策略：
    1. 合并连续的 userInputMessage
    2. 保留所有内容（包括 system-reminder）
    3. 确保 user-assistant 消息严格交替

    Args:
        history: Claude Code 的历史记录

    Returns:
        处理后的历史记录，符合 Amazon Q 格式
    """
    if not history:
        return []

    processed_history = []
    pending_user_messages = []

    logger.info(f"[MESSAGE_PROCESSOR] 开始处理历史记录，共 {len(history)} 条消息")

    for idx, msg in enumerate(history):
        if "userInputMessage" in msg:
            # 收集连续的用户消息
            pending_user_messages.append(msg["userInputMessage"])
            logger.debug(f"[MESSAGE_PROCESSOR] 消息 {idx}: 收集 userInputMessage，当前待合并数量: {len(pending_user_messages)}")

        elif "assistantResponseMessage" in msg:
            # 遇到助手消息时，先合并之前的用户消息
            if pending_user_messages:
                logger.info(f"[MESSAGE_PROCESSOR] 消息 {idx}: 合并 {len(pending_user_messages)} 条 userInputMessage")
                merged_user_msg = merge_user_messages(pending_user_messages)
                processed_history.append({
                    "userInputMessage": merged_user_msg
                })
                pending_user_messages = []

            # 添加助手消息
            logger.debug(f"[MESSAGE_PROCESSOR] 消息 {idx}: 添加 assistantResponseMessage")
            processed_history.append(msg)

    # 处理末尾剩余的用户消息
    if pending_user_messages:
        logger.info(f"[MESSAGE_PROCESSOR] 处理末尾剩余的 {len(pending_user_messages)} 条 userInputMessage")
        merged_user_msg = merge_user_messages(pending_user_messages)
        processed_history.append({
            "userInputMessage": merged_user_msg
        })

    logger.info(f"[MESSAGE_PROCESSOR] 历史记录处理完成，原始 {len(history)} 条 -> 处理后 {len(processed_history)} 条")

    # 验证消息交替
    try:
        validate_message_alternation(processed_history)
    except ValueError as e:
        logger.error(f"[MESSAGE_PROCESSOR] 消息交替验证失败: {e}")
        raise

    return processed_history


def validate_message_alternation(history: List[Dict[str, Any]]) -> bool:
    """
    验证消息是否严格交替（user-assistant-user-assistant...）

    Args:
        history: 历史记录

    Returns:
        是否有效

    Raises:
        ValueError: 如果消息不交替
    """
    if not history:
        return True

    last_role = None

    for idx, msg in enumerate(history):
        if "userInputMessage" in msg:
            current_role = "user"
        elif "assistantResponseMessage" in msg:
            current_role = "assistant"
        else:
            logger.warning(f"[MESSAGE_PROCESSOR] 消息 {idx} 既不是 user 也不是 assistant: {list(msg.keys())}")
            continue

        if last_role == current_role:
            error_msg = f"消息 {idx} 违反交替规则: 连续两个 {current_role} 消息"
            logger.error(f"[MESSAGE_PROCESSOR] {error_msg}")
            logger.error(f"[MESSAGE_PROCESSOR] 上一条消息: {list(history[idx-1].keys())}")
            logger.error(f"[MESSAGE_PROCESSOR] 当前消息: {list(msg.keys())}")
            raise ValueError(error_msg)

        last_role = current_role

    logger.info("[MESSAGE_PROCESSOR] 消息交替验证通过")
    return True


def log_history_summary(history: List[Dict[str, Any]], prefix: str = ""):
    """
    记录历史记录摘要，用于调试

    Args:
        history: 历史记录
        prefix: 日志前缀
    """
    if not history:
        logger.info(f"{prefix}历史记录为空")
        return

    summary = []
    for idx, msg in enumerate(history):
        if "userInputMessage" in msg:
            content = msg["userInputMessage"].get("content", "")
            # 取前80个字符作为预览
            content_preview = content[:80].replace("\n", " ") if content else ""
            summary.append(f"  [{idx}] USER: {content_preview}...")
        elif "assistantResponseMessage" in msg:
            content = msg["assistantResponseMessage"].get("content", "")
            content_preview = content[:80].replace("\n", " ") if content else ""
            summary.append(f"  [{idx}] ASSISTANT: {content_preview}...")

    logger.info(f"{prefix}历史记录摘要 (共 {len(history)} 条):\n" + "\n".join(summary))