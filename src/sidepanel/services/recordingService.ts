import { recordingRepo } from '../../db/repositories/recordingRepository';
import { recordingChunkRepo } from '../../db/repositories/recordingChunkRepository';
import { RecordingEvidence, RecordingStatus } from '../../shared/types/recording';
import { createEntityId } from '../../shared/utils/id';

interface StartRecordingOptions {
  sessionId: string;
  tabId: number;
  url: string;
}

type StatusListener = (status: RecordingStatus) => void;

let recorder: MediaRecorder | null = null;
let mediaStream: MediaStream | null = null;
let chunks: Blob[] = [];
let chunkIndex = 0;
let currentRecordingId: string | null = null;
let status: RecordingStatus = { active: false };
let recordingUrl = '';
let stopPromise: Promise<RecordingEvidence> | null = null;
const listeners = new Set<StatusListener>();

function publishStatus(nextStatus: RecordingStatus) {
  status = nextStatus;
  listeners.forEach((listener) => listener({ ...status }));
}

function releaseRecorder() {
  mediaStream?.getTracks().forEach((track) => track.stop());
  recorder = null;
  mediaStream = null;
  chunks = [];
  chunkIndex = 0;
  currentRecordingId = null;
  recordingUrl = '';
  stopPromise = null;
  publishStatus({ active: false });
}

function recordingMimeType(): string {
  return [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
  ].find((type) => MediaRecorder.isTypeSupported(type)) || '';
}

async function start(options: StartRecordingOptions): Promise<RecordingStatus> {
  if (recorder?.state === 'recording') return { ...status };
  if (!chrome.desktopCapture?.chooseDesktopMedia || !navigator.mediaDevices?.getUserMedia) {
    throw new Error('当前 Chrome 不支持标签页录屏');
  }

  // 复查问题 2: 若之前存在遗留分片，先尝试自动恢复转存；若恢复失败，坚决抛出异常阻止新录制，绝不继续覆盖旧分片
  const legacyRecordingIds = await recordingChunkRepo.listLegacyRecordingIds(options.sessionId);
  if (legacyRecordingIds.length > 0) {
    try {
      for (const legId of legacyRecordingIds) {
        await recoverRecordingById(legId, options.sessionId, options.tabId, options.url);
      }
    } catch (recoverErr) {
      console.error('[QA Copilot] 自动保存遗留录像分片失败:', recoverErr);
      throw new Error(`检测到上次未完成的录像分片正在恢复但保存失败，为防止数据损坏已阻止新录制：${(recoverErr as Error).message}`);
    }
  }

  try {
    // 只展示标签页，避免把侧边栏插件本身或整个桌面录进去。
    // streamId 必须在产生它的同一扩展页面中消费，不能跨传到 Offscreen Document。
    const streamId = await new Promise<string>((resolve, reject) => {
      chrome.desktopCapture.chooseDesktopMedia(['tab'], (id) => {
        const lastError = chrome.runtime.lastError;
        if (lastError) {
          reject(new Error(lastError.message));
        } else if (!id) {
          reject(new DOMException('用户取消了标签页选择', 'NotAllowedError'));
        } else {
          resolve(id);
        }
      });
    });

    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: streamId,
          maxFrameRate: 30,
        },
      },
    } as unknown as MediaStreamConstraints);
    if (mediaStream.getVideoTracks().length === 0) {
      throw new Error('没有获取到可录制的视频画面');
    }

    const mimeType = recordingMimeType();
    recorder = new MediaRecorder(mediaStream, mimeType ? { mimeType } : undefined);
    chunks = [];
    chunkIndex = 0;
    recordingUrl = options.url;
    // 复查问题 2: 为本次录制分配专属 recordingId，确保分片主键和存储空间与历史录制完全隔离
    const recordingId = createEntityId('recording');
    currentRecordingId = recordingId;

    recorder.ondataavailable = async (event) => {
      if (event.data.size > 0) {
        chunks.push(event.data);
        const currentIndex = chunkIndex++;
        publishStatus({ ...status, chunkCount: chunks.length });
        try {
          await recordingChunkRepo.saveChunk({
            id: `${recordingId}-chunk-${currentIndex}`,
            recordingId,
            sessionId: options.sessionId,
            chunkIndex: currentIndex,
            data: event.data,
            size: event.data.size,
            createdAt: Date.now(),
          });
        } catch (saveError) {
          console.warn('[QA Copilot] 录制分片持久化警告:', saveError);
        }
      }
    };

    const startedAt = Date.now();
    publishStatus({
      active: true,
      startedAt,
      sessionId: options.sessionId,
      tabId: options.tabId,
      chunkCount: 0,
    });
    recorder.start(1_000);

    // 用户从 Chrome 的“停止共享”按钮结束时，也要正常落库并捕获异常 (QA-007)
    mediaStream.getVideoTracks()[0].addEventListener('ended', () => {
      if (status.active) {
        stop().catch((err) => {
          console.error('[QA Copilot] 自动停止录屏失败:', err);
          publishStatus({ active: false, error: (err as Error).message });
        });
      }
    }, { once: true });

    return { ...status };
  } catch (error) {
    releaseRecorder();
    throw error;
  }
}

async function stop(): Promise<RecordingEvidence> {
  if (stopPromise) return stopPromise;
  if (!recorder || recorder.state === 'inactive' || !status.startedAt || !status.sessionId || status.tabId === undefined) {
    throw new Error('当前没有正在进行的录屏');
  }

  const activeRecorder = recorder;
  const activeRecordingId = currentRecordingId;
  const startedAt = status.startedAt;
  const sessionId = status.sessionId;
  const tabId = status.tabId;
  const url = recordingUrl;

  stopPromise = new Promise<RecordingEvidence>((resolve, reject) => {
    activeRecorder.onerror = (event) => {
      reject(new Error(event.error?.message || '浏览器录屏发生错误'));
      releaseRecorder();
    };
    activeRecorder.onstop = async () => {
      try {
        // 优先从 IndexedDB 中按序读取专属 recordingId 的分片以保障完整性
        let finalBlobs = chunks;
        if (activeRecordingId) {
          try {
            const dbChunks = await recordingChunkRepo.getChunksByRecordingId(activeRecordingId);
            if (dbChunks && dbChunks.length >= chunks.length && dbChunks.length > 0) {
              finalBlobs = dbChunks.map((c) => c.data);
            }
          } catch (chunkErr) {
            console.warn('[QA Copilot] 读取 DB 分片失败，使用内存分片兜底:', chunkErr);
          }
        }

        const blob = new Blob(finalBlobs, { type: activeRecorder.mimeType || 'video/webm' });
        const recording = await recordingRepo.add({
          id: activeRecordingId || createEntityId('recording'),
          sessionId,
          tabId,
          url,
          createdAt: startedAt,
          durationMs: Date.now() - startedAt,
          mimeType: blob.type,
          size: blob.size,
          blob,
        });

        // 成功生成完整录像后，清理专属分片数据
        if (activeRecordingId) {
          await recordingChunkRepo.clearChunksByRecordingId(activeRecordingId).catch(() => {});
        } else {
          await recordingChunkRepo.clearChunks(sessionId).catch(() => {});
        }
        resolve(recording);
      } catch (error) {
        reject(new Error(`录屏保存失败：${(error as Error).message}`));
      } finally {
        releaseRecorder();
      }
    };
    activeRecorder.stop();
  });

  return stopPromise;
}

const recoveringPromises = new Map<string, Promise<RecordingEvidence | null>>();

/**
 * 内部方法：按 recordingId 组装并恢复录像证据
 */
async function recoverRecordingById(
  recordingId: string,
  sessionId: string,
  tabId = 0,
  url = ''
): Promise<RecordingEvidence | null> {
  const recoveryKey = `${sessionId}:${recordingId}`;
  const inFlight = recoveringPromises.get(recoveryKey);
  if (inFlight) {
    return inFlight;
  }

  const recoveryTask = (async () => {
    try {
      let dbChunks = await recordingChunkRepo.getChunksByRecordingId(recordingId);
      if (!dbChunks || dbChunks.length === 0) {
        dbChunks = await recordingChunkRepo.getChunks(recordingId);
      }
      if (!dbChunks || dbChunks.length === 0) return null;

      // 修复 P2: 统一前缀判断；对无 recordingId 的旧分片建立基于 sessionId 与首分片时间戳的确定性稳定 ID，防止清理失败重试时重复入库
      const targetRecordingId =
        recordingId.startsWith('recording-') || recordingId.startsWith('recording_')
          ? recordingId
          : `recording-legacy-${sessionId}-${dbChunks[0]?.createdAt || 0}`;

      // 幂等防重：若该 targetRecordingId 已落库，清理残存分片并直接返回已有记录，杜绝重复插入生成重复录像
      const existing = await recordingRepo.getById(targetRecordingId);
      if (existing) {
        await recordingChunkRepo.clearChunksByRecordingId(recordingId).catch(() => {});
        if (recordingId === sessionId) {
          await recordingChunkRepo.clearChunks(sessionId).catch(() => {});
        }
        return existing;
      }

      const blob = new Blob(dbChunks.map((c) => c.data), { type: 'video/webm' });
      const startedAt = dbChunks[0].createdAt;
      const lastChunkAt = dbChunks[dbChunks.length - 1].createdAt;

      const recording = await recordingRepo.add({
        id: targetRecordingId,
        sessionId,
        tabId,
        url,
        createdAt: startedAt,
        durationMs: Math.max(1000, lastChunkAt - startedAt),
        mimeType: blob.type,
        size: blob.size,
        blob,
      });

      await recordingChunkRepo.clearChunksByRecordingId(recordingId).catch(() => {});
      if (recordingId === sessionId) {
        await recordingChunkRepo.clearChunks(sessionId).catch(() => {});
      }
      return recording;
    } finally {
      recoveringPromises.delete(recoveryKey);
    }
  })();

  recoveringPromises.set(recoveryKey, recoveryTask);
  return recoveryTask;
}

/**
 * 恢复异常中断未完成入库的录像分片 (QA-007)
 */
async function recoverUnsavedRecording(
  sessionId: string,
  tabId = 0,
  url = ''
): Promise<RecordingEvidence | null> {
  // 复查问题 1: 若当前正在录制中，绝对不能误将正在录制的分片当成中断录像进行恢复！
  if (status.active || recorder !== null) {
    return null;
  }

  const legacyIds = await recordingChunkRepo.listLegacyRecordingIds(sessionId, currentRecordingId || undefined);
  if (legacyIds.length > 0) {
    let last: RecordingEvidence | null = null;
    for (const legId of legacyIds) {
      last = await recoverRecordingById(legId, sessionId, tabId, url);
    }
    return last;
  }

  // 兜底按 sessionId 查找
  return await recoverRecordingById(sessionId, sessionId, tabId, url);
}

/**
 * 生产环境主动检查并自动恢复未完成的录屏分片 (QA-007)
 */
async function checkAndAutoRecover(
  sessionId: string,
  tabId = 0,
  url = ''
): Promise<RecordingEvidence | null> {
  // 复查问题 1: 若当前正在录制中，绝对不能执行自动恢复，避免误清空当前分片！
  if (status.active || recorder !== null) {
    return null;
  }

  try {
    const legacyIds = await recordingChunkRepo.listLegacyRecordingIds(sessionId, currentRecordingId || undefined);
    if (legacyIds.length > 0) {
      let lastRecovered: RecordingEvidence | null = null;
      for (const legacyId of legacyIds) {
        const recovered = await recoverRecordingById(legacyId, sessionId, tabId, url);
        if (recovered) {
          lastRecovered = recovered;
        }
      }
      return lastRecovered;
    }

    // 兜底检测未带 recordingId 的遗留分片
    const legacyChunks = await recordingChunkRepo.getChunks(sessionId);
    if (legacyChunks && legacyChunks.length > 0) {
      return await recoverRecordingById(sessionId, sessionId, tabId, url);
    }
  } catch (err) {
    console.warn('[QA Copilot] 检测/恢复未保存录像异常:', err);
  }
  return null;
}

export const recordingService = {
  start,
  stop,
  recoverUnsavedRecording,
  checkAndAutoRecover,
  getStatus: (): RecordingStatus => ({ ...status }),
  subscribe(listener: StatusListener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};
