export interface NetworkMockRule {
  id: string;
  name: string;
  enabled: boolean;
  method: string;
  urlPattern: string;
  status: number;
  delayMs: number;
  responseBody: string;
  contentType: string;
}
