import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Search, ChevronDown, Check, X, Loader2 } from 'lucide-react';

export interface SearchableOption {
  id: number | string;
  name: string;
  code?: string;
  subText?: string;
}

interface SearchableSelectProps {
  options: SearchableOption[];
  value: number | string;
  onChange: (value: any) => void;
  placeholder?: string;
  disabled?: boolean;
  loading?: boolean;
  className?: string;
  emptyText?: string;
  allowCustomInput?: boolean;
  showIdPrefix?: boolean;
}

export const SearchableSelect: React.FC<SearchableSelectProps> = ({
  options,
  value,
  onChange,
  placeholder = '请选择...',
  disabled = false,
  loading = false,
  className = '',
  emptyText = '暂无匹配数据',
  allowCustomInput = false,
  showIdPrefix,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [keyword, setKeyword] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // 点击外部自动关闭
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  // 展开时自动聚焦搜索输入框
  useEffect(() => {
    if (isOpen) {
      setKeyword('');
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  // 当前选中的选项
  const selectedOption = useMemo(() => {
    return options.find((opt) => String(opt.id) === String(value));
  }, [options, value]);

  // 模糊搜索过滤（匹配名称、代号、ID）
  const filteredOptions = useMemo(() => {
    const q = keyword.trim().toLowerCase();
    if (!q) return options;
    return options.filter((opt) => {
      const matchName = opt.name.toLowerCase().includes(q);
      const matchId = String(opt.id).toLowerCase().includes(q);
      const matchCode = opt.code ? opt.code.toLowerCase().includes(q) : false;
      const matchSub = opt.subText ? opt.subText.toLowerCase().includes(q) : false;
      return matchName || matchId || matchCode || matchSub;
    });
  }, [options, keyword]);

  return (
    <div ref={containerRef} className={`relative w-full text-xs select-none ${className}`}>
      {/* 触发按钮 */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setIsOpen(!isOpen)}
        className={`w-full px-3 py-2 bg-white border rounded-lg flex items-center justify-between text-left transition-all shadow-xs outline-none cursor-pointer ${
          disabled
            ? 'bg-slate-100 border-slate-200 text-slate-400 cursor-not-allowed'
            : isOpen
            ? 'border-blue-500 ring-2 ring-blue-500/20 text-slate-800'
            : 'border-slate-200 hover:border-slate-300 text-slate-800'
        }`}
      >
        <div className="flex items-center gap-1.5 min-w-0 flex-1 mr-2">
          {selectedOption ? (
            <>
              {(showIdPrefix ?? !isNaN(Number(selectedOption.id))) && (
                <span className="font-semibold text-slate-900 shrink-0">#{selectedOption.id}</span>
              )}
              <span className="truncate font-medium text-slate-800">{selectedOption.name}</span>
              {selectedOption.subText && (
                <span className="shrink-0 text-[10px] text-slate-400 font-mono">
                  ({selectedOption.subText})
                </span>
              )}
              {selectedOption.code && (
                <span className="shrink-0 px-1.5 py-0.2 text-[10px] bg-slate-100 text-slate-600 rounded font-mono">
                  {selectedOption.code}
                </span>
              )}
            </>
          ) : value ? (
            <span className="truncate font-medium text-slate-800 font-mono">{String(value)}</span>
          ) : (
            <span className="text-slate-400 truncate">{placeholder}</span>
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0 text-slate-400">
          {loading ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-500" />
          ) : (
            <ChevronDown
              className={`w-3.5 h-3.5 transition-transform duration-200 ${isOpen ? 'rotate-180 text-blue-600' : ''}`}
            />
          )}
        </div>
      </button>

      {/* 下拉浮层 */}
      {isOpen && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1.5 bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden animate-in fade-in zoom-in-95 duration-100">
          {/* 搜索框 */}
          <div className="p-2 border-b border-slate-100 bg-slate-50/70 flex items-center gap-1.5">
            <Search className="w-3.5 h-3.5 text-slate-400 shrink-0 ml-1" />
            <input
              ref={inputRef}
              type="text"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  if (allowCustomInput && keyword.trim()) {
                    onChange(keyword.trim());
                    setIsOpen(false);
                  } else if (filteredOptions.length > 0) {
                    onChange(filteredOptions[0].id);
                    setIsOpen(false);
                  }
                }
              }}
              placeholder="输入名称、代号或 ID 快速搜索..."
              className="w-full bg-transparent text-xs text-slate-800 placeholder-slate-400 focus:outline-none"
            />
            {keyword && (
              <button
                type="button"
                onClick={() => setKeyword('')}
                className="p-0.5 text-slate-400 hover:text-slate-600 rounded"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>

          {/* 自由输入快捷项 */}
          {allowCustomInput && keyword.trim() && (
            <div
              onClick={() => {
                onChange(keyword.trim());
                setIsOpen(false);
              }}
              className="px-2.5 py-1.5 mx-1 mt-1 bg-indigo-50/90 hover:bg-indigo-100 text-indigo-900 rounded-lg cursor-pointer transition-colors flex items-center justify-between border border-indigo-200/80 text-xs"
            >
              <div className="flex items-center gap-1.5 truncate">
                <span className="font-bold text-indigo-600 text-[11px]">+ 直接使用:</span>
                <span className="font-mono font-medium">{keyword.trim()}</span>
              </div>
              <span className="text-[10px] text-indigo-500 font-sans shrink-0">点击选用</span>
            </div>
          )}

          {/* 列表项 */}
          <div className="max-h-56 overflow-y-auto p-1 divide-y divide-slate-50/50">
            {filteredOptions.length > 0 ? (
              filteredOptions.map((opt) => {
                const isSelected = String(opt.id) === String(value);
                const hasNumericId = !isNaN(Number(opt.id));
                const shouldShowId = showIdPrefix ?? hasNumericId;
                return (
                  <div
                    key={opt.id}
                    onClick={() => {
                      onChange(opt.id);
                      setIsOpen(false);
                    }}
                    className={`flex items-center justify-between px-2.5 py-1.5 rounded-lg cursor-pointer transition-colors ${
                      isSelected
                        ? 'bg-blue-50 text-blue-900 font-semibold'
                        : 'hover:bg-slate-100/80 text-slate-700'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 min-w-0 flex-1 mr-2">
                      {shouldShowId && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 font-mono shrink-0">
                          #{opt.id}
                        </span>
                      )}
                      <span className="truncate text-xs">{opt.name}</span>
                      {opt.subText && (
                        <span className="text-[10px] text-slate-400 font-mono truncate">
                          ({opt.subText})
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      {opt.code && (
                        <span className="text-[10px] text-slate-400 font-mono">{opt.code}</span>
                      )}
                      {isSelected && <Check className="w-3.5 h-3.5 text-blue-600" />}
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="py-6 text-center text-slate-400 text-xs">
                {keyword ? '未找到匹配项' : emptyText}
              </div>
            )}
          </div>

          {/* 底部统计栏 */}
          {options.length > 0 && (
            <div className="px-2.5 py-1.5 border-t border-slate-100 bg-slate-50/50 text-[10px] text-slate-400 flex items-center justify-between">
              <span>共 {options.length} 项</span>
              {keyword && <span>匹配到 {filteredOptions.length} 项</span>}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
