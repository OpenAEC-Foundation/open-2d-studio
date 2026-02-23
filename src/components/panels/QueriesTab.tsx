import { useState, useMemo, useCallback } from 'react';
import { Plus, Play, Trash2, Table2 } from 'lucide-react';
import { useAppStore } from '../../state/appStore';
import { executeQuery, AVAILABLE_TABLES } from '../../services/query/queryEngine';
import { QUERY_TEMPLATES } from '../../services/query/queryTemplates';
import type { QueryResult } from '../../services/query/queryEngine';

const CATEGORY_COLORS: Record<string, string> = {
  schedule: 'bg-blue-500/30 text-blue-300',
  'quantity-takeoff': 'bg-amber-500/30 text-amber-300',
  analysis: 'bg-emerald-500/30 text-emerald-300',
  custom: 'bg-gray-500/30 text-gray-300',
};

const CATEGORY_LABELS: Record<string, string> = {
  schedule: 'SCH',
  'quantity-takeoff': 'QTO',
  analysis: 'ANA',
  custom: 'USR',
};

export function QueriesTab() {
  const shapes = useAppStore((s) => s.shapes);
  const drawings = useAppStore((s) => s.drawings);
  const pileTypes = useAppStore((s) => s.pileTypes);
  const editorMode = useAppStore((s) => s.editorMode);

  // Use store-managed queries
  const queries = useAppStore((s) => s.queries);
  const activeQueryId = useAppStore((s) => s.activeQueryId);
  const addQuery = useAppStore((s) => s.addQuery);
  const updateQuery = useAppStore((s) => s.updateQuery);
  const deleteQuery = useAppStore((s) => s.deleteQuery);
  const setActiveQuery = useAppStore((s) => s.setActiveQuery);
  const startQueryPlacement = useAppStore((s) => s.startQueryPlacement);

  const [queryResult, setQueryResult] = useState<QueryResult | null>(null);

  const activeQuery = useMemo(
    () => queries.find((q) => q.id === activeQueryId) ?? null,
    [queries, activeQueryId],
  );

  const isSheetMode = editorMode === 'sheet';

  // --- Actions ---

  const handleNewQuery = useCallback(() => {
    const id = addQuery({
      name: `Query ${queries.length + 1}`,
      sql: 'SELECT * FROM shapes LIMIT 20',
      category: 'analysis',
    });
    setActiveQuery(id);
    setQueryResult(null);
  }, [addQuery, queries.length, setActiveQuery]);

  const handleTemplateSelect = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const template = QUERY_TEMPLATES.find((t) => t.id === e.target.value);
      if (template) {
        const id = addQuery({
          name: template.name,
          sql: template.sql,
          category: template.category,
        });
        setActiveQuery(id);
        setQueryResult(null);
      }
      // Reset select
      e.target.value = '';
    },
    [addQuery, setActiveQuery],
  );

  const handleExecute = useCallback(() => {
    if (!activeQuery) return;
    const result = executeQuery(activeQuery.sql, { shapes, drawings, pileTypes });
    setQueryResult(result);
  }, [activeQuery, shapes, drawings, pileTypes]);

  const handleSqlChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      if (!activeQuery) return;
      updateQuery(activeQuery.id, { sql: e.target.value });
    },
    [activeQuery, updateQuery],
  );

  const handleDelete = useCallback(() => {
    if (!activeQuery) return;
    deleteQuery(activeQuery.id);
    setQueryResult(null);
  }, [activeQuery, deleteQuery]);

  const handlePlaceOnSheet = useCallback(() => {
    if (!activeQuery || !isSheetMode) return;
    // First execute the query so we have results for sizing
    const result = executeQuery(activeQuery.sql, { shapes, drawings, pileTypes });
    setQueryResult(result);
    // Start placement mode
    startQueryPlacement(activeQuery.id);
  }, [activeQuery, isSheetMode, shapes, drawings, pileTypes, startQueryPlacement]);

  // --- Render ---

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-1 px-2 py-1 border-b border-cad-border">
        <button
          onClick={handleNewQuery}
          className="p-1 rounded hover:bg-cad-border transition-colors"
          title="New Query"
        >
          <Plus size={14} />
        </button>
        <select
          onChange={handleTemplateSelect}
          className="flex-1 min-w-0 text-[10px] bg-cad-surface border border-cad-border rounded px-1 py-0.5 text-cad-text cursor-pointer outline-none hover:bg-cad-hover"
          defaultValue=""
        >
          <option value="" disabled>
            From Template...
          </option>
          {QUERY_TEMPLATES.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </div>

      {/* Query List */}
      <div className="overflow-auto border-b border-cad-border" style={{ maxHeight: '30%' }}>
        {queries.length === 0 ? (
          <div className="text-xs text-cad-text-dim text-center py-4">
            No queries yet.
            <br />
            Create a new query or pick a template.
          </div>
        ) : (
          <div className="p-1 space-y-0.5">
            {queries.map((query) => {
              const isActive = query.id === activeQueryId;
              return (
                <div
                  key={query.id}
                  onClick={() => {
                    setActiveQuery(query.id);
                    setQueryResult(null);
                  }}
                  className={`group flex items-center gap-1.5 px-2 py-1 rounded cursor-default transition-colors ${
                    isActive
                      ? 'bg-cad-accent/20 border border-cad-accent'
                      : 'hover:bg-cad-border/50 border border-transparent'
                  }`}
                >
                  <Table2 size={12} className="text-cad-text-dim shrink-0" />
                  <div className="flex-1 min-w-0">
                    <span className="text-xs text-cad-text truncate block">
                      {query.name}
                    </span>
                  </div>
                  <span
                    className={`text-[9px] font-medium px-1 rounded shrink-0 ${
                      CATEGORY_COLORS[query.category] ?? 'bg-gray-500/30 text-gray-300'
                    }`}
                  >
                    {CATEGORY_LABELS[query.category] ?? query.category}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* SQL Editor + Results */}
      {activeQuery ? (
        <div className="flex-1 flex flex-col min-h-0">
          {/* SQL Editor */}
          <div className="flex flex-col border-b border-cad-border">
            <textarea
              value={activeQuery.sql}
              onChange={handleSqlChange}
              spellCheck={false}
              className="w-full bg-cad-bg text-cad-text text-[11px] font-mono p-2 resize-none outline-none border-none"
              style={{ minHeight: 80, maxHeight: 160 }}
              placeholder="SELECT * FROM shapes"
            />
            <div className="flex items-center gap-1 px-2 py-1 bg-cad-surface">
              <button
                onClick={handleExecute}
                className="flex items-center gap-1 px-2 py-0.5 text-[10px] bg-cad-accent/20 text-cad-accent rounded hover:bg-cad-accent/30 transition-colors"
                title="Execute Query"
              >
                <Play size={10} />
                Execute
              </button>
              <button
                onClick={handleDelete}
                className="flex items-center gap-1 px-2 py-0.5 text-[10px] text-cad-text-dim rounded hover:bg-red-500/20 hover:text-red-400 transition-colors"
                title="Delete Query"
              >
                <Trash2 size={10} />
                Delete
              </button>
              <div className="flex-1" />
              <button
                disabled={!isSheetMode}
                onClick={handlePlaceOnSheet}
                className={`flex items-center gap-1 px-2 py-0.5 text-[10px] rounded transition-colors ${
                  isSheetMode
                    ? 'bg-cad-accent/20 text-cad-accent hover:bg-cad-accent/30 cursor-pointer'
                    : 'text-cad-text-dim/40 cursor-not-allowed'
                }`}
                title={isSheetMode ? 'Place query table on sheet' : 'Switch to sheet mode to place on sheet'}
              >
                <Table2 size={10} />
                Place on Sheet
              </button>
            </div>
          </div>

          {/* Results */}
          <div className="flex-1 overflow-auto min-h-0">
            {queryResult ? (
              queryResult.error ? (
                <div className="p-2">
                  <div className="text-[10px] text-red-400 bg-red-500/10 rounded p-2 font-mono whitespace-pre-wrap">
                    {queryResult.error}
                  </div>
                  <div className="text-[9px] text-cad-text-dim mt-1">
                    {queryResult.executionTimeMs.toFixed(1)}ms
                  </div>
                </div>
              ) : (
                <div className="flex flex-col h-full">
                  {/* Status bar */}
                  <div className="flex items-center gap-2 px-2 py-0.5 text-[9px] text-cad-text-dim border-b border-cad-border bg-cad-surface shrink-0">
                    <span>{queryResult.rows.length} row{queryResult.rows.length !== 1 ? 's' : ''}</span>
                    <span>{queryResult.columns.length} col{queryResult.columns.length !== 1 ? 's' : ''}</span>
                    <span>{queryResult.executionTimeMs.toFixed(1)}ms</span>
                  </div>

                  {/* Table */}
                  {queryResult.rows.length > 0 ? (
                    <div className="flex-1 overflow-auto">
                      <table className="w-full text-[10px]">
                        <thead>
                          <tr className="text-cad-text-dim border-b border-cad-border sticky top-0 bg-cad-surface">
                            {queryResult.columns.map((col) => (
                              <th
                                key={col}
                                className="text-left px-1.5 py-0.5 font-medium whitespace-nowrap"
                              >
                                {col}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {queryResult.rows.map((row, i) => (
                            <tr
                              key={i}
                              className={`transition-colors ${
                                i % 2 === 0
                                  ? 'bg-transparent'
                                  : 'bg-cad-border/20'
                              } hover:bg-cad-border/40`}
                            >
                              {queryResult.columns.map((col) => (
                                <td
                                  key={col}
                                  className="px-1.5 py-0.5 text-cad-text whitespace-nowrap tabular-nums"
                                >
                                  {row[col] === null || row[col] === undefined
                                    ? <span className="text-cad-text-dim">NULL</span>
                                    : String(row[col])}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="text-xs text-cad-text-dim text-center py-4">
                      Query returned no rows.
                    </div>
                  )}
                </div>
              )
            ) : (
              <div className="text-xs text-cad-text-dim text-center py-4">
                Press Execute to run the query.
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="flex-1 flex flex-col">
          {/* Available tables reference */}
          {queries.length > 0 && (
            <div className="p-2 text-[10px] text-cad-text-dim">
              Select a query from the list above.
            </div>
          )}
          <div className="flex-1" />
          <div className="p-2 border-t border-cad-border">
            <div className="text-[9px] text-cad-text-dim mb-1 font-medium">Available tables:</div>
            <div className="flex flex-wrap gap-1">
              {AVAILABLE_TABLES.map((t) => (
                <span
                  key={t}
                  className="text-[9px] px-1 py-0.5 bg-cad-border/50 rounded text-cad-text-dim"
                >
                  {t}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
