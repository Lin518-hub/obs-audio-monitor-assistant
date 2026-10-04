/** Keep command lines, encoded scripts and stack traces out of operator-facing UI. */
export function preflightError(error: unknown, fallback = '操作未完成，请重试；详细信息已记录到日志'): string {
  const raw = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  const message = raw.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '');
  if (/已取消|交回操作权|AbortError|aborted/i.test(message)) return '已交回操作权，后续自动操作已停止';
  if (/EACCES|EPERM|access.*denied|拒绝访问|权限不足/i.test(message)) return '权限不足，请确认助手与目标软件使用相同权限后重试';
  if (/ETIMEDOUT|timed out|timeout/i.test(message)) return '等待软件响应超时，请检查是否有未处理的弹窗后重试';
  if (/ENOENT/i.test(message)) return '程序路径不存在，请重新选择程序或快捷方式';
  if (!message || message.length > 240 || /Command failed|powershell|EncodedCommand|CategoryInfo|FullyQualifiedErrorId|\n\s*at\s|Error invoking remote method/i.test(message)) return fallback;
  return message.replace(/\x1b\[[0-9;]*m/g, '').trim();
}
