/**
 * Window Tiling Control — src/directionalMove.js
 * Pure, geometry-based i3-style directional movement model.
 *
 * A window is classified by its ACTUAL geometry (not tracked snap state) into a
 * slot, then a direction maps to a neighbouring zone. Being geometry-based makes
 * movement reliable for windows we never snapped (dragged, GNOME-tiled, CSD).
 *
 * Slots:  maxi | L | R | TL | TR | BL | BR
 * Quarter zone indices: TL=0, TR=1, BL=2, BR=3.  Half indices: L=0, R=1.
 */

/**
 * Direction → target [presetId, zoneIndex] per slot, or null at an outer edge.
 * Moving off the outer edge of a quarter "grows" it to the full-height half on
 * that side (natural and reversible).
 */
export const SLOT_MOVES = {
    maxi: { left: ["halves", 0],   right: ["halves", 1],   up: null,            down: null },
    L:    { left: null,            right: ["halves", 1],   up: ["quarters", 0], down: ["quarters", 2] },
    R:    { left: ["halves", 0],   right: null,            up: ["quarters", 1], down: ["quarters", 3] },
    TL:   { left: ["halves", 0],   right: ["quarters", 1], up: ["halves", 0],   down: ["quarters", 2] },
    TR:   { left: ["quarters", 0], right: ["halves", 1],   up: ["halves", 1],   down: ["quarters", 3] },
    BL:   { left: ["halves", 0],   right: ["quarters", 3], up: ["quarters", 0], down: ["halves", 0] },
    BR:   { left: ["quarters", 2], right: ["halves", 1],   up: ["quarters", 1], down: ["halves", 1] },
};

/** Fraction of the workarea a window must cover to count as "spanning" an axis. */
const SPAN_THRESHOLD = 0.7;

/**
 * Classify a window's frame rect within a workarea into a movement slot.
 *
 * @param {{x:number,y:number,width:number,height:number}} frame
 * @param {{x:number,y:number,width:number,height:number}} workarea
 * @returns {"maxi"|"L"|"R"|"TL"|"TR"|"BL"|"BR"}
 */
export function classifySlot(frame, workarea) {
    const spanW = frame.width  >= workarea.width  * SPAN_THRESHOLD;
    const spanH = frame.height >= workarea.height * SPAN_THRESHOLD;
    const left  = (frame.x + frame.width  / 2) < (workarea.x + workarea.width  / 2);
    const top   = (frame.y + frame.height / 2) < (workarea.y + workarea.height / 2);

    if (spanW && spanH) return "maxi";
    if (spanH)          return left ? "L" : "R";
    return `${top ? "T" : "B"}${left ? "L" : "R"}`;
}

/** Map a tracked snap entry (presetId + zoneIndex) → movement slot. */
const ENTRY_TO_SLOT = {
    halves:   { 0: "L",  1: "R" },
    quarters: { 0: "TL", 1: "TR", 2: "BL", 3: "BR" },
};

/**
 * Derive the movement slot from a tracked snap entry. This is EXACT and
 * immune to apps that don't honour the requested size (terminals with cell-size
 * increments like Ghostty, or min-size CSD apps like Nautilus), whose real
 * geometry drifts from the ideal zone and would otherwise misclassify.
 *
 * @param {{presetId: string, zoneIndex: number}|null|undefined} entry
 * @returns {string|null} slot, or null when the entry isn't a built-in zone.
 */
export function slotFromEntry(entry) {
    if (!entry) return null;
    return ENTRY_TO_SLOT[entry.presetId]?.[entry.zoneIndex] ?? null;
}

/**
 * Resolve the target zone for a directional move.
 *
 * @param {string} slot       - from classifySlot()
 * @param {"left"|"right"|"up"|"down"} direction
 * @returns {[string, number] | null}  [presetId, zoneIndex], or null at an edge.
 */
export function resolveMove(slot, direction) {
    return SLOT_MOVES[slot]?.[direction] ?? null;
}
