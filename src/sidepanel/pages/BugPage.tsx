/** Bug 与问题快照历史列表。 */

import React, { useEffect, useState } from 'react';
import { AlertTriangle, ArrowLeft, Bug, Camera, ChevronRight, FileEdit } from 'lucide-react';
import { snapshotRepo } from '../../db/repositories/snapshotRepository';
import { Bug as BugRecord, BugSnapshot } from '../../shared/types/snapshot';
import { useAppStore } from '../store/useAppStore';

export const BugPage: React.FC = () => {
  const { setCurrentTab, setActiveView } = useAppStore();
  const [snapshots, setSnapshots] = useState<BugSnapshot[]>([]);
  const [bugs, setBugs] = useState<BugRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([snapshotRepo.listSnapshots(), snapshotRepo.listBugs(50)])
      .then(([snapshotList, bugList]) => {
        setSnapshots(snapshotList);
        setBugs(bugList);
      })
      .finally(() => setLoading(false));
  }, []);

  const openSnapshot = (snapshot: BugSnapshot) => {
    useAppStore.setState({ currentSnapshot: snapshot });
    setActiveView('bug_editor');
  };

  const bugBySnapshot = new Map(bugs.map((bug) => [bug.snapshotId, bug]));

  return (
    <div className="flex flex-col gap-3 p-4 pb-20 text-xs">
      <div className="flex items-center gap-2">
        <button onClick={() => setCurrentTab('home')} className="p-1 text-slate-500 hover:text-slate-800">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <h2 className="text-sm font-bold text-slate-900">Bug 与问题快照</h2>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="bg-white border border-slate-200 rounded-xl p-3">
          <div className="text-slate-400 text-[10px]">问题快照</div>
          <div className="text-lg font-bold text-slate-900">{snapshots.length}</div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-3">
          <div className="text-slate-400 text-[10px]">已保存草稿</div>
          <div className="text-lg font-bold text-blue-600">{bugs.filter((bug) => bug.status === 'draft').length}</div>
        </div>
      </div>

      {loading ? (
        <div className="py-10 text-center text-slate-400">正在读取本地记录…</div>
      ) : snapshots.length === 0 ? (
        <div className="py-12 bg-white border border-slate-200 rounded-xl text-center text-slate-400">
          <Bug className="w-8 h-8 mx-auto mb-2 text-slate-300" />
          <p>暂无问题快照</p>
          <p className="mt-1 text-[11px]">测试过程中点击“发现问题”即可保存现场</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {snapshots.map((snapshot) => {
            const bug = bugBySnapshot.get(snapshot.id);
            return (
              <button
                key={snapshot.id}
                onClick={() => openSnapshot(snapshot)}
                className="w-full text-left bg-white border border-slate-200 rounded-xl p-3 hover:border-blue-300 hover:bg-blue-50/30 transition-colors"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-semibold text-slate-900 truncate">
                      {bug?.title || `问题快照 ${snapshot.id}`}
                    </div>
                    <div className="mt-1 text-[10px] text-slate-400 font-mono truncate">{snapshot.url}</div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
                </div>
                <div className="mt-2 flex items-center gap-2 text-[10px]">
                  <span className="text-slate-500">{new Date(snapshot.createdAt).toLocaleString()}</span>
                  {snapshot.summary.errorCount > 0 && (
                    <span className="flex items-center gap-0.5 bg-red-50 text-red-600 px-1.5 py-0.5 rounded">
                      <AlertTriangle className="w-3 h-3" />异常 {snapshot.summary.errorCount}
                    </span>
                  )}
                  {snapshot.screenshotUrl && (
                    <span className="flex items-center gap-0.5 text-emerald-600">
                      <Camera className="w-3 h-3" />截图
                    </span>
                  )}
                  <span className={`ml-auto flex items-center gap-0.5 px-1.5 py-0.5 rounded ${
                    bug ? 'bg-blue-50 text-blue-600' : 'bg-slate-100 text-slate-500'
                  }`}>
                    <FileEdit className="w-3 h-3" />{bug ? '草稿' : '未编辑'}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
