export function captureText(value: unknown, maxLength = 20_000): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value.slice(0, maxLength);

  // 针对 Error 或原生 DOMException 等异常对象，提取具体的错误类型与详细消息，防止转成无用的 "[object DOMException]"
  if (value instanceof Error || (typeof value === 'object' && value !== null && 'message' in value && 'name' in value)) {
    const err = value as { name?: string; message?: string; stack?: string };
    const text = err.stack || `${err.name || 'Error'}: ${err.message || ''}`;
    return text.slice(0, maxLength);
  }

  try {
    const json = JSON.stringify(value);
    if (json === '{}' && typeof value === 'object') {
      return String(value).slice(0, maxLength);
    }
    return json.slice(0, maxLength);
  } catch {
    return String(value).slice(0, maxLength);
  }
}

export function captureHeaders(
  headers: Array<{ name: string; value: string }> = []
): Array<{ name: string; value: string }> {
  return headers.map(({ name, value }) => ({ name, value }));
}
