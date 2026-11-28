import type { KeyboardEvent as ReactKeyboardEvent } from "react";

const textInputTypes = new Set([
  "text",
  "search",
  "url",
  "tel",
  "email",
  "password",
  "number",
]);

export function isApplicationSelectAll(event: KeyboardEvent) {
  if (
    event.defaultPrevented ||
    event.isComposing ||
    !(event.ctrlKey || event.metaKey) ||
    event.altKey ||
    event.shiftKey ||
    event.key.toLowerCase() !== "a"
  )
    return false;

  const target = event.target;
  return !(
    (target instanceof HTMLElement && target.isContentEditable) ||
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLInputElement && textInputTypes.has(target.type))
  );
}

export function selectAllInList(
  event: ReactKeyboardEvent<HTMLElement>,
  select: () => void,
) {
  if (
    event.target instanceof Node &&
    event.currentTarget.contains(event.target) &&
    isApplicationSelectAll(event.nativeEvent)
  ) {
    event.preventDefault();
    select();
  }
}
