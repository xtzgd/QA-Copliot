import { NetworkRequest } from '../types/network';

function quoteShell(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

export function buildCurlCommand(request: NetworkRequest): string {
  const parts = ['curl', '-X', request.method.toUpperCase(), quoteShell(request.url)];
  request.requestHeaders?.forEach(({ name, value }) => {
    parts.push('-H', quoteShell(`${name}: ${value}`));
  });
  if (request.requestBody) {
    parts.push('--data-raw', quoteShell(request.requestBody));
  }
  return parts.join(' ');
}
