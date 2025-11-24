import util from 'util';
import { addLog } from '../admin/log_manager.js';

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m'
};

function formatArg(arg) {
  if (typeof arg === 'string') return arg;
  // 展开嵌套对象，避免日志中出现 [Object]
  return util.inspect(arg, {
    depth: null,
    colors: true,
    compact: false,
    maxArrayLength: null
  });
}

// 格式化参数用于文件存储（移除颜色代码）
function formatArgForFile(arg) {
  if (typeof arg === 'string') return arg;
  return util.inspect(arg, {
    depth: null,
    colors: false, // 文件存储不需要颜色
    compact: false,
    maxArrayLength: null
  });
}

function logMessage(level, ...args) {
  const timestamp = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  const color = { info: colors.green, warn: colors.yellow, error: colors.red }[level];
  const formattedArgs = args.map(formatArg);

  // 打印到控制台
  console.log(`${colors.gray}${timestamp}${colors.reset} ${color}[${level}]${colors.reset}`, ...formattedArgs);

  // 同时写入日志文件（异步，不阻塞主流程）
  const messageForFile = args.map(formatArgForFile).join(' ');
  addLog(level, messageForFile).catch(err => {
    // 日志写入失败时静默处理，避免影响主流程
    console.error('写入日志文件失败:', err);
  });
}

function logRequest(method, path, status, duration, options = {}) {
  const { reqBody, resBody } = options;
  const statusColor = status >= 500 ? colors.red : status >= 400 ? colors.yellow : colors.green;
  const timestamp = new Date().toLocaleTimeString('zh-CN', { hour12: false });

  // 打印到控制台
  console.log(`${colors.cyan}[${method}]${colors.reset} - ${path} ${statusColor}${status}${colors.reset} ${colors.gray}${duration}ms${colors.reset}`);

  // 打印请求体（如果有）
  if (reqBody) {
    //console.log(`${colors.gray}├─ Request:${colors.reset}`, formatArg(reqBody));
  }

  // 打印响应体（如果有且非流式）
  if (resBody) {
    //console.log(`${colors.gray}└─ Response:${colors.reset}`, formatArg(resBody));
  }

  // 写入日志文件
  const level = status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info';
  let message = `[${method}] ${path} ${status} ${duration}ms`;

  // 将请求响应也写入日志文件
  if (reqBody) {
    message += `\n├─ Request: ${formatArgForFile(reqBody)}`;
  }
  if (resBody) {
    message += `\n└─ Response: ${formatArgForFile(resBody)}`;
  }

  addLog(level, message).catch(err => {
    console.error('写入日志文件失败:', err);
  });
}

export const log = {
  info: (...args) => logMessage('info', ...args),
  warn: (...args) => logMessage('warn', ...args),
  error: (...args) => logMessage('error', ...args),
  request: logRequest
};

export default log;
