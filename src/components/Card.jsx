import React from "react";
import { FiPlus } from "react-icons/fi";

// ─────────────────────────────────────────────
//  Difficulty badge colour map
// ─────────────────────────────────────────────
const LEVEL_STYLES = {
  مبتدئ: "badge-warning text-warning-content",
  متوسط: "badge-success text-success-content",
  متقدم: "badge-error text-error-content",
};

/**
 * Card component – displays a single matn (متن) in the library grid.
 *
 * Props (all will eventually come from the backend):
 *  @param {string}  title       - عنوان المتن
 *  @param {string}  author      - اسم المؤلف
 *  @param {string}  level       - مستوى الصعوبة: "مبتدئ" | "متوسط" | "متقدم"
 *  @param {string}  [category]  - التصنيف (اختياري للعرض المستقبلي)
 *  @param {boolean} [isAdded]   - هل تمت إضافة المتن للخطة؟
 *  @param {func}    [onAdd]     - callback عند الضغط على زر الإضافة
 */
export default function Card({ title, author, level, category, isAdded = false, onAdd }) {
  const levelStyle = LEVEL_STYLES[level] ?? "badge-ghost";

  return (
    <div
      className="
        card bg-base-100 border border-base-200
        shadow-md hover:shadow-xl
        transition-all duration-300 hover:-translate-y-1
        w-full
      "
      dir="rtl"
    >
      {/* ── Coloured top accent bar ── */}
      <div className="h-1 w-full rounded-t-2xl bg-2" />

      <div className="card-body p-5 gap-3">
        {/* Title */}
        <h2 className="card-title font-3 font-bold text-xl text-base-content leading-snug">
          {title}
        </h2>

        {/* Author */}
        <div className="flex flex-col gap-0.5">
          <span className="text-xs text-base-content/50 font-2">المؤلف</span>
          <span className="text-sm font-2 text-base-content/80 font-medium">
            {author}
          </span>
        </div>

        {/* Footer: level badge + add button */}
        <div className="card-actions justify-between items-center mt-2">
          {/* Add button */}
          <button
            onClick={onAdd}
            aria-label="إضافة المتن"
            className="
              btn btn-sm btn-ghost btn-circle
              border border-base-300
              hover:bg-2 hover:text-white hover:border-transparent
              transition-colors duration-200
            "
          >
            <FiPlus className="text-lg" />
          </button>

          {/* Difficulty level badge */}
          {level && (
            <span className={`badge badge-sm font-2 font-semibold ${levelStyle}`}>
              {level}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
