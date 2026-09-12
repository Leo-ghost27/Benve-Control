"use client";

import { useState, useTransition } from "react";
import { addSampleItem, updateSampleItem, deleteSampleItem } from "@/lib/actions/populations";

type SampleItem = {
  id: string;
  item_number: number;
  item_reference: string;
  item_value: number | null;
  item_date: string | null;
  result: string;
  notes: string | null;
};

const resultOptions = [
  { value: "not_tested", label: "Not tested" },
  { value: "pass", label: "Pass" },
  { value: "exception", label: "Exception" },
  { value: "not_applicable", label: "Not applicable" },
];

const resultDot: Record<string, string> = {
  not_tested: "bg-mute",
  pass: "bg-emerald-400",
  exception: "bg-rose-400",
  not_applicable: "bg-blue-400",
};

const inputClass =
  "w-full min-w-[110px] rounded-md border border-line bg-panel px-2.5 py-1.5 text-xs text-paper placeholder:text-mute focus:outline-none focus:ring-1 focus:ring-signal";

export function SampleItemsTable({
  populationId,
  testPlanId,
  initialItems,
}: {
  populationId: string;
  testPlanId: string;
  initialItems: SampleItem[];
}) {
  const [items, setItems] = useState<SampleItem[]>(initialItems);
  const [savedAt, setSavedAt] = useState<Record<string, number>>({});
  const [, startTransition] = useTransition();

  function markSaved(id: string) {
    setSavedAt((s) => ({ ...s, [id]: Date.now() }));
    setTimeout(() => {
      setSavedAt((s) => {
        const copy = { ...s };
        delete copy[id];
        return copy;
      });
    }, 1500);
  }

  function updateLocal(id: string, field: keyof SampleItem, value: string | number | null) {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, [field]: value } : i)));
  }

  async function persistField(
    id: string,
    field: keyof SampleItem,
    value: string | number | null
  ) {
    try {
      await updateSampleItem(id, testPlanId, { [field]: value });
      markSaved(id);
    } catch (err) {
      console.error(err);
    }
  }

  async function handleAdd() {
    startTransition(async () => {
      try {
        const newItem = await addSampleItem(populationId, testPlanId);
        setItems((prev) => [...prev, newItem as SampleItem]);
      } catch (err) {
        console.error(err);
      }
    });
  }

  async function handleDelete(id: string) {
    setItems((prev) => prev.filter((i) => i.id !== id));
    startTransition(async () => {
      try {
        await deleteSampleItem(id, testPlanId);
      } catch (err) {
        console.error(err);
      }
    });
  }

  const exceptionCount = items.filter((i) => i.result === "exception").length;
  const passCount = items.filter((i) => i.result === "pass").length;

  return (
    <div>
      <div className="mb-2 flex items-center gap-4 text-xs text-mute">
        <span>{items.length} items</span>
        <span className="text-emerald-400">{passCount} pass</span>
        {exceptionCount > 0 && (
          <span className="text-rose-400">{exceptionCount} exception{exceptionCount !== 1 ? "s" : ""}</span>
        )}
      </div>

      <div className="overflow-x-auto rounded-xl border border-line">
        <table className="w-full border-collapse text-left text-xs">
          <thead className="bg-panel text-[10px] uppercase tracking-wide text-mute">
            <tr>
              <th className="px-2 py-2.5 font-medium">#</th>
              <th className="px-2 py-2.5 font-medium">Item reference</th>
              <th className="px-2 py-2.5 font-medium">Value</th>
              <th className="px-2 py-2.5 font-medium">Date</th>
              <th className="px-2 py-2.5 font-medium">Result</th>
              <th className="px-2 py-2.5 font-medium">Notes</th>
              <th className="px-2 py-2.5 font-medium"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line bg-ink">
            {items.map((item) => (
              <tr key={item.id} className="align-top">
                <td className="px-2 py-2 font-mono text-mute">{item.item_number}</td>
                <td className="px-2 py-2">
                  <input
                    type="text"
                    className={inputClass}
                    defaultValue={item.item_reference}
                    onChange={(e) => updateLocal(item.id, "item_reference", e.target.value)}
                    onBlur={(e) => persistField(item.id, "item_reference", e.target.value)}
                    placeholder="Transaction / doc ID"
                  />
                </td>
                <td className="px-2 py-2">
                  <input
                    type="text"
                    inputMode="decimal"
                    className={inputClass}
                    defaultValue={item.item_value ?? ""}
                    onChange={(e) => updateLocal(item.id, "item_value", e.target.value)}
                    onBlur={(e) =>
                      persistField(
                        item.id,
                        "item_value",
                        e.target.value ? Number(e.target.value) : null
                      )
                    }
                    placeholder="0.00"
                  />
                </td>
                <td className="px-2 py-2">
                  <input
                    type="date"
                    className={inputClass}
                    defaultValue={item.item_date ?? ""}
                    onChange={(e) => updateLocal(item.id, "item_date", e.target.value)}
                    onBlur={(e) => persistField(item.id, "item_date", e.target.value || null)}
                  />
                </td>
                <td className="px-2 py-2">
                  <div className="flex items-center gap-1.5">
                    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${resultDot[item.result] ?? "bg-mute"}`} />
                    <select
                      className="w-full rounded-md border border-line bg-panel px-1.5 py-1.5 text-xs text-paper focus:outline-none focus:ring-1 focus:ring-signal"
                      value={item.result}
                      onChange={(e) => {
                        updateLocal(item.id, "result", e.target.value);
                        persistField(item.id, "result", e.target.value);
                      }}
                    >
                      {resultOptions.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </td>
                <td className="px-2 py-2">
                  <input
                    type="text"
                    className={inputClass}
                    defaultValue={item.notes ?? ""}
                    onChange={(e) => updateLocal(item.id, "notes", e.target.value)}
                    onBlur={(e) => persistField(item.id, "notes", e.target.value)}
                  />
                </td>
                <td className="px-2 py-2">
                  <div className="flex flex-col items-center gap-1">
                    <button
                      type="button"
                      onClick={() => handleDelete(item.id)}
                      className="rounded border border-line px-1.5 py-0.5 text-mute hover:border-rose-400 hover:text-rose-400"
                    >
                      Delete
                    </button>
                    <span
                      className={`text-[10px] transition-opacity ${
                        savedAt[item.id] ? "opacity-100 text-emerald-400" : "opacity-0"
                      }`}
                    >
                      Saved
                    </span>
                  </div>
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-mute">
                  No sample items yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <button
        type="button"
        onClick={handleAdd}
        className="mt-3 rounded-md border border-line px-4 py-2 text-xs font-medium text-paper transition-colors hover:border-signal"
      >
        + Add sample item
      </button>
    </div>
  );
}
