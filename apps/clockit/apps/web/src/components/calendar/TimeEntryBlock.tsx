import { format, addDays } from "date-fns";
import { useRef, useState } from "react";

interface TimeEntryBlockProps {
  entry: any;
  hourHeight: number;
  column?: number;
  totalColumns?: number;
  onClick: () => void;
  onDrag: (newStart: Date, newEnd: Date) => void;
  onResize: (newStart: Date, newEnd: Date) => void;
}

const SNAP_MINUTES = 15;

function snapMinutes(deltaY: number, hourHeight: number) {
  return Math.round((deltaY / hourHeight) * 60 / SNAP_MINUTES) * SNAP_MINUTES;
}

export function TimeEntryBlock({
  entry,
  hourHeight,
  column = 0,
  totalColumns = 1,
  onClick,
  onDrag,
  onResize,
}: TimeEntryBlockProps) {
  const [dragOffset, setDragOffset] = useState<{ x: number; y: number } | null>(null);
  const [resizePreview, setResizePreview] = useState<{ top: number; height: number } | null>(null);
  const blockRef = useRef<HTMLDivElement>(null);
  const movedRef = useRef(false);

  if (!entry.end) return null;

  const startDate = new Date(entry.start);
  const endDate = new Date(entry.end);
  const durationMinutes = Math.round((endDate.getTime() - startDate.getTime()) / 60000);

  // Position within the day column (REQ-CAL-F08)
  const startHour = startDate.getHours() + startDate.getMinutes() / 60;
  const top = startHour * hourHeight;
  const height = (durationMinutes / 60) * hourHeight;

  // Side-by-side layout for overlapping entries (REQ-CAL-F10)
  const widthPct = 100 / totalColumns;
  const leftPct = column * widthPct;

  // REQ-CAL-F27: drag to reschedule (vertical = time, horizontal = day)
  const handleMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("[data-resize]")) return;
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();

    const startX = e.clientX;
    const startY = e.clientY;
    const originalStart = new Date(entry.start);
    const originalEnd = new Date(entry.end);
    const dayWidth = blockRef.current?.parentElement?.offsetWidth || 0;
    movedRef.current = false;

    const computeDelta = (ev: MouseEvent) => {
      const deltaMinutes = snapMinutes(ev.clientY - startY, hourHeight);
      const deltaDays = dayWidth > 0 ? Math.round((ev.clientX - startX) / dayWidth) : 0;
      return { deltaMinutes, deltaDays };
    };

    const handleMouseMove = (ev: MouseEvent) => {
      const { deltaMinutes, deltaDays } = computeDelta(ev);
      if (deltaMinutes !== 0 || deltaDays !== 0) movedRef.current = true;
      setDragOffset({
        x: deltaDays * dayWidth,
        y: (deltaMinutes / 60) * hourHeight,
      });
    };

    const handleMouseUp = (ev: MouseEvent) => {
      const { deltaMinutes, deltaDays } = computeDelta(ev);
      if (deltaMinutes !== 0 || deltaDays !== 0) {
        const shiftMs = deltaMinutes * 60000;
        const newStart = addDays(new Date(originalStart.getTime() + shiftMs), deltaDays);
        const newEnd = addDays(new Date(originalEnd.getTime() + shiftMs), deltaDays);
        onDrag(newStart, newEnd);
      }
      setDragOffset(null);
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  };

  // REQ-CAL-F28: resize from top (start) or bottom (end) edge
  const handleResizeMouseDown = (edge: "top" | "bottom") => (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();

    const startY = e.clientY;
    const originalStart = new Date(entry.start);
    const originalEnd = new Date(entry.end);
    movedRef.current = false;

    const computeTimes = (ev: MouseEvent) => {
      const deltaMinutes = snapMinutes(ev.clientY - startY, hourHeight);
      let newStart = originalStart;
      let newEnd = originalEnd;
      if (edge === "bottom") {
        newEnd = new Date(originalEnd.getTime() + deltaMinutes * 60000);
        if (newEnd.getTime() - newStart.getTime() < SNAP_MINUTES * 60000) {
          newEnd = new Date(newStart.getTime() + SNAP_MINUTES * 60000);
        }
      } else {
        newStart = new Date(originalStart.getTime() + deltaMinutes * 60000);
        if (newEnd.getTime() - newStart.getTime() < SNAP_MINUTES * 60000) {
          newStart = new Date(newEnd.getTime() - SNAP_MINUTES * 60000);
        }
      }
      return { newStart, newEnd, deltaMinutes };
    };

    const handleMouseMove = (ev: MouseEvent) => {
      const { newStart, newEnd, deltaMinutes } = computeTimes(ev);
      if (deltaMinutes !== 0) movedRef.current = true;
      const previewStartHour = newStart.getHours() + newStart.getMinutes() / 60;
      const previewMinutes = Math.round((newEnd.getTime() - newStart.getTime()) / 60000);
      setResizePreview({
        top: previewStartHour * hourHeight,
        height: (previewMinutes / 60) * hourHeight,
      });
    };

    const handleMouseUp = (ev: MouseEvent) => {
      const { newStart, newEnd, deltaMinutes } = computeTimes(ev);
      if (deltaMinutes !== 0) {
        onResize(newStart, newEnd);
      }
      setResizePreview(null);
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  };

  const displayTop = resizePreview ? resizePreview.top : top;
  const displayHeight = resizePreview ? resizePreview.height : height;

  return (
    <div
      ref={blockRef}
      className={`absolute rounded px-2 py-1 cursor-move overflow-hidden ${
        dragOffset ? "opacity-70 z-20 shadow-lg" : "z-10"
      }`}
      style={{
        top: `${displayTop}px`,
        height: `${Math.max(displayHeight, 20)}px`,
        left: `calc(${leftPct}% + 2px)`,
        width: `calc(${widthPct}% - 4px)`,
        backgroundColor: entry.project?.color || "#4f46e5",
        transform: dragOffset ? `translate(${dragOffset.x}px, ${dragOffset.y}px)` : undefined,
      }}
      onMouseDown={handleMouseDown}
      onClick={(e) => {
        e.stopPropagation();
        if (!movedRef.current) {
          onClick();
        }
        movedRef.current = false;
      }}
    >
      {/* Top resize handle */}
      <div
        data-resize
        className="absolute top-0 left-0 right-0 h-1.5 cursor-n-resize hover:bg-black hover:bg-opacity-20"
        onMouseDown={handleResizeMouseDown("top")}
      ></div>

      <div className="text-white text-xs font-medium truncate">
        {entry.description || "(no description)"}
      </div>
      {displayHeight > 30 && entry.project?.name && (
        <div className="text-white text-xs opacity-80 truncate">
          {entry.project.name}
        </div>
      )}
      {displayHeight > 50 && (
        <div className="text-white text-xs opacity-80">
          {format(startDate, "HH:mm")} - {format(endDate, "HH:mm")}
        </div>
      )}

      {/* Bottom resize handle */}
      <div
        data-resize
        className="absolute bottom-0 left-0 right-0 h-1.5 cursor-s-resize hover:bg-black hover:bg-opacity-20"
        onMouseDown={handleResizeMouseDown("bottom")}
      ></div>
    </div>
  );
}

/**
 * REQ-CAL-F10: assign side-by-side columns to overlapping entries of one day.
 * Returns entries decorated with { column, totalColumns } within overlap groups.
 */
export function layoutDayEntries(entries: any[]): any[] {
  const sorted = [...entries]
    .filter((e) => e.end)
    .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());

  const result: any[] = [];
  let group: any[] = [];
  let groupColumns: Date[] = []; // end time of last entry per column
  let groupMaxEnd = 0;

  const flushGroup = () => {
    const total = groupColumns.length || 1;
    group.forEach((item) => {
      result.push({ ...item.entry, column: item.column, totalColumns: total });
    });
    group = [];
    groupColumns = [];
    groupMaxEnd = 0;
  };

  sorted.forEach((entry) => {
    const start = new Date(entry.start).getTime();
    const end = new Date(entry.end).getTime();

    if (group.length > 0 && start >= groupMaxEnd) {
      flushGroup();
    }

    let column = -1;
    for (let i = 0; i < groupColumns.length; i++) {
      if (groupColumns[i].getTime() <= start) {
        column = i;
        break;
      }
    }
    if (column === -1) {
      column = groupColumns.length;
      groupColumns.push(new Date(end));
    } else {
      groupColumns[column] = new Date(end);
    }

    group.push({ entry, column });
    groupMaxEnd = Math.max(groupMaxEnd, end);
  });

  flushGroup();
  return result;
}

/**
 * REQ-CAL-B15/F: read-only block for synced external calendar events,
 * visually distinct (dashed border, muted style) from native entries.
 */
export function ExternalEventBlock({
  event,
  hourHeight,
}: {
  event: any;
  hourHeight: number;
}) {
  const startDate = new Date(event.start);
  const endDate = new Date(event.end);
  const durationMinutes = Math.round((endDate.getTime() - startDate.getTime()) / 60000);
  const startHour = startDate.getHours() + startDate.getMinutes() / 60;
  const top = startHour * hourHeight;
  const height = (durationMinutes / 60) * hourHeight;

  return (
    <div
      className="absolute left-1 right-1 rounded px-2 py-1 overflow-hidden border border-dashed bg-white bg-opacity-80 pointer-events-none"
      style={{
        top: `${top}px`,
        height: `${Math.max(height, 20)}px`,
        borderColor: event.color || "#94a3b8",
      }}
      title={`${event.title} (synced from ${event.provider})`}
    >
      <div className="text-xs font-medium truncate" style={{ color: event.color || "#475569" }}>
        {event.title}
      </div>
      {height > 30 && (
        <div className="text-xs text-slate-400 truncate">
          {format(startDate, "HH:mm")} - {format(endDate, "HH:mm")} · {event.provider}
        </div>
      )}
    </div>
  );
}
