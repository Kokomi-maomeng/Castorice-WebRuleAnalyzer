import { useRef } from "react";

interface RangeSelection {
  keys: readonly string[];
  scope?: string;
  isSelected: (key: string) => boolean;
  onSelect: (keys: readonly string[], selected: boolean) => void;
}

export default function useRangeSelection({
  keys,
  scope,
  isSelected,
  onSelect,
}: RangeSelection) {
  const anchor = useRef<{ key: string; scope?: string } | null>(null);

  return (key: string, shiftKey: boolean) => {
    if (shiftKey && anchor.current && anchor.current.scope === scope) {
      const start = keys.indexOf(anchor.current.key);
      const end = keys.indexOf(key);
      if (start >= 0 && end >= 0) {
        onSelect(
          keys.slice(Math.min(start, end), Math.max(start, end) + 1),
          true,
        );
        return;
      }
    }

    anchor.current = { key, scope };
    onSelect([key], !isSelected(key));
  };
}
