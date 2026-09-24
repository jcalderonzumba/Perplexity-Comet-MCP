// The mode catalogue: what each `comet_mode` tool mode selects on
// Perplexity's page, or why it cannot be selected.
//
// The page labels are the part Perplexity changes, so they live here and
// nowhere else. Pure data and lookups: no DOM, no CDP.

/** The tool modes, in the order the tool contract publishes them. */
export const TOOL_MODES = ["search", "research", "labs", "learn"] as const;

export type ToolMode = (typeof TOOL_MODES)[number];

/** A mode the page offers, by the label of its item in the mode menu. */
export interface SelectableMode {
  readonly selectable: true;
  readonly pageLabel: string;
}

/** A mode the tool accepts but cannot switch the page to, and why. */
export interface UnselectableMode {
  readonly selectable: false;
  readonly reason: string;
}

export type ModeEntry = SelectableMode | UnselectableMode;

export const MODE_CATALOGUE: Readonly<Record<ToolMode, ModeEntry>> = {
  search: { selectable: true, pageLabel: "Search" },
  research: { selectable: true, pageLabel: "Deep research" },
  labs: {
    selectable: false,
    reason: "not offered by Perplexity's current input bar",
  },
  learn: { selectable: false, reason: "not supported yet" },
};

export function isToolMode(value: unknown): value is ToolMode {
  return (TOOL_MODES as readonly unknown[]).includes(value);
}

/**
 * The tool mode whose page label is exactly `label`, or `undefined` when
 * the catalogue knows no such label. Page scripts return labels with
 * whitespace already trimmed and collapsed.
 */
export function toolModeForPageLabel(label: string): ToolMode | undefined {
  return TOOL_MODES.find((mode) => {
    const entry = MODE_CATALOGUE[mode];
    return entry.selectable && entry.pageLabel === label;
  });
}
