export interface CdpInputAction {
  kind: 'click' | 'type';
  x: number;
  y: number;
  text?: string;
}
