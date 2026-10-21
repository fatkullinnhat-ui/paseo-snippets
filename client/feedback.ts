export type FeedbackTone = "idle" | "selected" | "hover" | "pressed";

export function feedbackTone({ pressed, hovered, focused, selected }: {
  pressed: boolean;
  hovered: boolean;
  focused: boolean;
  selected: boolean;
}): FeedbackTone {
  if (pressed) return "pressed";
  if (hovered || focused) return "hover";
  return selected ? "selected" : "idle";
}
