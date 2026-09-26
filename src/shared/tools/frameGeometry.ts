/**
 * Frame geometry helpers shared by element inspection and replay.
 * Coordinates are mapped through each iframe's content box so CSS zoom,
 * borders, padding, and affine transforms are included where the browser
 * exposes the content quad.
 */

export interface FramePoint {
  x: number;
  y: number;
  frameCssPath?: string[];
  frameXPath?: string[];
  zoom?: number;
}

export interface FrameGeometry {
  left: number;
  top: number;
  zoom: number;
  frameXPath: string[];
  frameCssPath: string[];
  complete: boolean;
}

const FRAME_GEOMETRY_SOURCE = 'QA_COPILOT_FRAME_GEOMETRY';
const pendingFramePointRequests = new Map<string, {
  resolve: (point: FramePoint | null) => void;
  timer: ReturnType<typeof setTimeout>;
}>();
let frameGeometryListenerInstalled = false;

/** Chromium exposes CSSStyleDeclaration.zoom even though it is non-standard. */
export function parseCSSZoom(style: CSSStyleDeclaration): number {
  const zoom = Number.parseFloat((style as CSSStyleDeclaration & { zoom?: string }).zoom ?? '1');
  return Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
}

function xpathLiteral(value: string): string {
  if (!value.includes("'")) return `'${value}'`;
  if (!value.includes('"')) return `"${value}"`;
  return `concat(${value.split("'").map((part, index) => `${index ? `,"'",` : ''}'${part}'`).join('')})`;
}

function getFrameXPath(frame: Element): string {
  if (frame.id) {
    try {
      if (frame.ownerDocument.querySelectorAll(`#${escapeCssIdentifier(frame.id)}`).length === 1) {
        return `//*[@id=${xpathLiteral(frame.id)}]`;
      }
    } catch {}
  }
  const name = frame.getAttribute('name');
  if (name && Array.from(frame.ownerDocument.querySelectorAll('iframe,frame')).filter((candidate) => candidate.getAttribute('name') === name).length === 1) {
    return `//${frame.tagName.toLowerCase()}[@name=${xpathLiteral(name)}]`;
  }

  const parts: string[] = [];
  let current: Element | null = frame;
  while (current && current !== frame.ownerDocument.documentElement) {
    const siblings = current.parentElement
      ? Array.from(current.parentElement.children).filter((item) => item.tagName === current?.tagName)
      : [];
    const index = siblings.length > 1 ? `[${siblings.indexOf(current) + 1}]` : '';
    parts.unshift(`${current.tagName.toLowerCase()}${index}`);
    current = current.parentElement;
  }
  return `/html/${parts.join('/')}`;
}

function escapeCssIdentifier(value: string): string {
  const cssEscape = (globalThis as typeof globalThis & { CSS?: typeof CSS }).CSS?.escape;
  if (cssEscape) return cssEscape(value);
  return Array.from(value).map((char, index) => {
    const code = char.codePointAt(0) || 0;
    if (code === 0) return '\\fffd ';
    if ((code >= 1 && code <= 31) || code === 127 || (index === 0 && code >= 48 && code <= 57) ||
      (index === 1 && value[0] === '-' && code >= 48 && code <= 57)) {
      return `\\${code.toString(16)} `;
    }
    if (code >= 128 || char === '-' || char === '_' || /[a-zA-Z0-9]/.test(char)) return char;
    return `\\${char}`;
  }).join('');
}

function getFrameCssSelector(frame: Element): string {
  const path: string[] = [];
  let current: Element | null = frame;
  while (current && current !== frame.ownerDocument.documentElement) {
    const tag = current.tagName.toLowerCase();
    const name = current === frame ? current.getAttribute('name') : null;
    let segment = current.id
      ? `${tag}#${escapeCssIdentifier(current.id)}`
      : name
        ? `${tag}[name=${JSON.stringify(name)}]`
        : tag;
    if (current.parentElement) {
      const siblings = Array.from(current.parentElement.children).filter((item) => item.tagName === current?.tagName);
      if (siblings.length > 1) segment += `:nth-of-type(${siblings.indexOf(current) + 1})`;
    }
    path.unshift(segment);
    current = current.parentElement;
  }
  path.unshift('html');
  return path.join(' > ');
}

/**
 * Midscene-style accumulated iframe offset for the accessible part of a
 * frame chain. Cross-origin boundaries are reported through `complete`.
 */
export function calculateIframeOffset(nodeOwnerDoc: Document, rootDoc?: Document): FrameGeometry {
  let left = 0;
  let top = 0;
  let accumulatedZoom = 1;
  let iterDoc: Document | null = nodeOwnerDoc;
  const frameXPath: string[] = [];
  const frameCssPath: string[] = [];
  let complete = true;

  while (iterDoc && (!rootDoc || iterDoc !== rootDoc)) {
    const childWindow: Window | null = iterDoc.defaultView;
    if (!childWindow || childWindow === childWindow.top) break;

    try {
      const frameElement: Element | null = childWindow.frameElement;
      if (!frameElement) {
        complete = false;
        break;
      }
      const parentWindow = frameElement.ownerDocument.defaultView;
      if (!parentWindow) {
        complete = false;
        break;
      }
      const style = parentWindow.getComputedStyle(frameElement);
      const zoom = parseCSSZoom(style);
      const mappedPoint = mapChildPointIntoParent(frameElement, { x: left, y: top });
      left = mappedPoint.x;
      top = mappedPoint.y;
      accumulatedZoom *= zoom;
      frameXPath.unshift(getFrameXPath(frameElement));
      frameCssPath.unshift(getFrameCssSelector(frameElement));
      iterDoc = frameElement.ownerDocument;
    } catch {
      complete = false;
      break;
    }
  }

  if (iterDoc?.defaultView && iterDoc.defaultView !== iterDoc.defaultView.top && !rootDoc) {
    complete = false;
  }

  return { left, top, zoom: accumulatedZoom, frameXPath, frameCssPath, complete };
}

function mapChildPointIntoParent(frameElement: Element, point: FramePoint): FramePoint {
  const style = frameElement.ownerDocument.defaultView?.getComputedStyle(frameElement);
  if (!style) throw new Error('读取 iframe 样式失败');

  const frame = frameElement as Element & {
    getBoxQuads?: (options?: { box?: string }) => Array<{
      p1: DOMPoint;
      p2: DOMPoint;
      p4: DOMPoint;
    }>;
  };
  let contentQuad: { p1: DOMPoint; p2: DOMPoint; p4: DOMPoint } | undefined;
  try {
    contentQuad = frame.getBoxQuads?.({ box: 'content' })?.[0];
  } catch {}
  if (contentQuad) {
    const paddingLeft = Number.parseFloat(style.paddingLeft) || 0;
    const paddingRight = Number.parseFloat(style.paddingRight) || 0;
    const paddingTop = Number.parseFloat(style.paddingTop) || 0;
    const paddingBottom = Number.parseFloat(style.paddingBottom) || 0;
    const width = Math.max(1, frameElement.clientWidth - paddingLeft - paddingRight);
    const height = Math.max(1, frameElement.clientHeight - paddingTop - paddingBottom);
    const u = point.x / width;
    const v = point.y / height;
    return {
      x: contentQuad.p1.x + u * (contentQuad.p2.x - contentQuad.p1.x) + v * (contentQuad.p4.x - contentQuad.p1.x),
      y: contentQuad.p1.y + u * (contentQuad.p2.y - contentQuad.p1.y) + v * (contentQuad.p4.y - contentQuad.p1.y),
    };
  }

  // Fallback for browsers without getBoxQuads: rect/offset dimensions form
  // an axis-aligned scale matrix; CSS zoom is the fallback scale if needed.
  const rect = frameElement.getBoundingClientRect();
  const frameMetrics = frameElement as HTMLElement;
  const zoom = parseCSSZoom(style);
  const scaleX = frameMetrics.offsetWidth > 0 ? rect.width / frameMetrics.offsetWidth : zoom;
  const scaleY = frameMetrics.offsetHeight > 0 ? rect.height / frameMetrics.offsetHeight : zoom;
  const borderLeft = Number.parseFloat(style.borderLeftWidth) || 0;
  const borderTop = Number.parseFloat(style.borderTopWidth) || 0;
  const paddingLeft = Number.parseFloat(style.paddingLeft) || 0;
  const paddingTop = Number.parseFloat(style.paddingTop) || 0;
  return {
    x: rect.left + (borderLeft + paddingLeft) * scaleX + point.x * scaleX,
    y: rect.top + (borderTop + paddingTop) * scaleY + point.y * scaleY,
  };
}

function installFrameGeometryListener(): void {
  if (frameGeometryListenerInstalled || typeof window === 'undefined') return;
  frameGeometryListenerInstalled = true;

  window.addEventListener('message', (event: MessageEvent) => {
    const data = event.data;
    if (!data || data.source !== FRAME_GEOMETRY_SOURCE || typeof data.requestId !== 'string') return;

    if (data.type === 'response') {
      if (event.source !== window.parent) return;
      const pending = pendingFramePointRequests.get(data.requestId);
      if (!pending) return;
      clearTimeout(pending.timer);
      pendingFramePointRequests.delete(data.requestId);
      const point = Number.isFinite(data.x) && Number.isFinite(data.y)
        ? {
            x: Number(data.x),
            y: Number(data.y),
            frameCssPath: Array.isArray(data.frameCssPath) ? data.frameCssPath.filter((item: unknown) => typeof item === 'string') : [],
            frameXPath: Array.isArray(data.frameXPath) ? data.frameXPath.filter((item: unknown) => typeof item === 'string') : [],
            zoom: Number.isFinite(data.zoom) && Number(data.zoom) > 0 ? Number(data.zoom) : 1,
          }
        : null;
      pending.resolve(point);
      return;
    }

    if (data.type !== 'request' || !event.source || !Number.isFinite(data.x) || !Number.isFinite(data.y)) return;
    const source = event.source as WindowProxy;
    const frame = Array.from(document.querySelectorAll('iframe,frame'))
      .find((candidate) => (candidate as HTMLIFrameElement).contentWindow === source);
    if (!frame) return;

    let parentPoint: FramePoint;
    try {
      parentPoint = mapChildPointIntoParent(frame, { x: Number(data.x), y: Number(data.y) });
    } catch {
      return;
    }

    const respond = (point: FramePoint | null) => {
      try {
        source.postMessage({
          source: FRAME_GEOMETRY_SOURCE,
          type: 'response',
          requestId: data.requestId,
          x: point?.x,
          y: point?.y,
          frameCssPath: point?.frameCssPath,
          frameXPath: point?.frameXPath,
          zoom: point?.zoom,
        }, event.origin === 'null' ? '*' : event.origin);
      } catch {}
    };

    const frameCssSelector = getFrameCssSelector(frame);
    const frameXPath = getFrameXPath(frame);
    const style = frame.ownerDocument.defaultView?.getComputedStyle(frame);
    const localZoom = style ? parseCSSZoom(style) : 1;
    if (window === window.top) {
      respond({
        ...parentPoint,
        frameCssPath: [frameCssSelector],
        frameXPath: [frameXPath],
        zoom: localZoom,
      });
      return;
    }
    mapPointToTopFrame(parentPoint.x, parentPoint.y)
      .then((topPoint) => respond(topPoint && {
        x: topPoint.x,
        y: topPoint.y,
        frameCssPath: [...(topPoint.frameCssPath || []), frameCssSelector],
        frameXPath: [...(topPoint.frameXPath || []), frameXPath],
        zoom: (topPoint.zoom || 1) * localZoom,
      }))
      .catch(() => respond(null));
  }, true);
}

/** Install at content-script startup so parent frames can relay child requests. */
export function initializeFrameGeometryRelay(): void {
  installFrameGeometryListener();
}

/** Map a frame-local viewport point to the top frame, including cross-origin ancestors. */
export function mapPointToTopFrame(x: number, y: number, timeoutMs = 2_000): Promise<FramePoint | null> {
  if (typeof window === 'undefined' || window === window.top) {
    return Promise.resolve({ x, y, frameCssPath: [], frameXPath: [], zoom: 1 });
  }
  installFrameGeometryListener();

  const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pendingFramePointRequests.delete(requestId);
      resolve(null);
    }, timeoutMs);
    pendingFramePointRequests.set(requestId, { resolve, timer });
    try {
      window.parent.postMessage({ source: FRAME_GEOMETRY_SOURCE, type: 'request', requestId, x, y }, '*');
    } catch {
      clearTimeout(timer);
      pendingFramePointRequests.delete(requestId);
      resolve(null);
    }
  });
}

/** Useful for frame-aware locator output and for diagnosing inaccessible ancestry. */
export function getCurrentFrameGeometry(): FrameGeometry {
  return calculateIframeOffset(document);
}
