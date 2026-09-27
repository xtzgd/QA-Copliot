export function captureText(value: unknown, maxLength = 20_000): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value.slice(0, maxLength);

  // 针对原生 Error、DOMException 或携带 stack 的错误对象，提取具体堆栈与详细消息，防止转成无用的 "[object Error]"
  // 注意：不能仅凭 'name' in value && 'message' in value 判定，因为业务 JSON 经常含有 name 和 message 字段！
  if (
    value instanceof Error ||
    (typeof value === 'object' &&
      value !== null &&
      (('stack' in value && typeof (value as { stack?: unknown }).stack === 'string') ||
        (value as { name?: unknown }).name === 'DOMException' ||
        (value as { constructor?: { name?: unknown } }).constructor?.name === 'DOMException'))
  ) {
    const err = value as { name?: string; message?: string; stack?: string };
    const text = err.stack || `${err.name || 'Error'}: ${err.message || ''}`;
    return text.slice(0, maxLength);
  }

  // 针对 FormData 提取键值对象
  if (typeof FormData !== 'undefined' && value instanceof FormData) {
    try {
      const record: Record<string, string> = {};
      value.forEach((v, k) => {
        record[k] = typeof v === 'string' ? v : (v as File).name;
      });
      return JSON.stringify(record).slice(0, maxLength);
    } catch {}
  }

  // 针对 URLSearchParams 序列化为 query string
  if (typeof URLSearchParams !== 'undefined' && value instanceof URLSearchParams) {
    return value.toString().slice(0, maxLength);
  }

  try {
    const json = JSON.stringify(value);
    if (json !== undefined) {
      return json.slice(0, maxLength);
    }
    return String(value).slice(0, maxLength);
  } catch {
    return String(value).slice(0, maxLength);
  }
}

export function captureHeaders(
  headers: Array<{ name: string; value: string }> = []
): Array<{ name: string; value: string }> {
  return headers.map(({ name, value }) => ({ name, value }));
}
