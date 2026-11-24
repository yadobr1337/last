"use client";

import { useId, useState, type ReactNode } from "react";
import { Button } from "./button";

type Row = { id: string; cells: ReactNode[]; group?: string };

export function DataTable({ label, columns, rows, empty, filterLabel, pageSize = 8 }: {
  label: string;
  columns: string[];
  rows: Row[];
  empty: string;
  filterLabel?: string;
  pageSize?: number;
}) {
  const filterId = useId();
  const [filter, setFilter] = useState("");
  const [page, setPage] = useState(0);
  const groups = Array.from(new Set(rows.flatMap((row) => row.group ? [row.group] : []))).sort();
  const filtered = filter ? rows.filter((row) => row.group === filter) : rows;
  const lastPage = Math.max(0, Math.ceil(filtered.length / pageSize) - 1);
  const displayPage = Math.min(page, lastPage);
  const visible = filtered.slice(displayPage * pageSize, (displayPage + 1) * pageSize);

  return (
    <div className="grid min-w-0 gap-3">
      {filterLabel && groups.length > 1 ? <label htmlFor={filterId} className="flex flex-wrap items-center gap-2 text-sm text-muted">
        {filterLabel}
        <select id={filterId} className="ui-input ui-select table-filter" value={filter} onChange={(event) => {
          setFilter(event.target.value);
          setPage(0);
        }}>
          <option value="">Все</option>
          {groups.map((group) => <option key={group} value={group}>{group}</option>)}
        </select>
      </label> : null}
      {visible.length ? (
        <div className="table-frame">
          <table className="ui-table" aria-label={label}>
            <thead><tr>{columns.map((column) => <th key={column} scope="col">{column}</th>)}</tr></thead>
            <tbody>
              {visible.map((row) => (
                <tr key={row.id}>
                  {row.cells.map((cell, index) => <td key={columns[index]} data-label={columns[index]}>{cell}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <p className="ui-empty">{empty}</p>}
      {lastPage > 0 ? (
        <div className="flex flex-wrap items-center justify-end gap-2" aria-label="Страницы таблицы">
          <Button variant="ghost" size="sm" type="button" disabled={displayPage === 0} onClick={() => setPage(displayPage - 1)}>Назад</Button>
          <span className="text-sm text-muted tabular-nums" aria-live="polite">{displayPage + 1} из {lastPage + 1}</span>
          <Button variant="ghost" size="sm" type="button" disabled={displayPage >= lastPage} onClick={() => setPage(displayPage + 1)}>Далее</Button>
        </div>
      ) : null}
    </div>
  );
}
