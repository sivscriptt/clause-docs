"use client";

export function PrintButton() {
  return (
    <button type="button" onClick={() => window.print()} className="h-9 rounded-full bg-accent px-3 text-sm font-medium text-white hover:bg-accent/90">
      Print or save as PDF
    </button>
  );
}
