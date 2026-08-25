import { useState, useEffect, useRef } from "react";
import { parseDuration } from "../tracker/format";

interface DurationInputProps {
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
}

// REQ-TS-F14 / I-B: a cell accepts H:MM, HH:MM:SS, decimal hours ("1.5") and
// minutes with an "m" suffix ("45m"); it is normalised to H:MM on commit.
export function DurationInput({ value, onChange, disabled }: DurationInputProps) {
  const [inputValue, setInputValue] = useState(value);
  const [isFocused, setIsFocused] = useState(false);
  const escapedRef = useRef(false);

  useEffect(() => {
    if (!isFocused) {
      setInputValue(value);
    }
  }, [value, isFocused]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;

    // Allow empty input
    if (newValue === "") {
      setInputValue("");
      return;
    }

    // Digits, colons, a decimal point and a trailing h/m unit while typing
    if (!/^[\d:.hm\s]*$/i.test(newValue)) {
      return;
    }

    setInputValue(newValue);
  };

  const handleBlur = () => {
    setIsFocused(false);

    // Escape pressed: discard the edit
    if (escapedRef.current) {
      escapedRef.current = false;
      setInputValue(value);
      return;
    }

    // Clearing the cell removes the entry
    if (inputValue === "") {
      if (value !== "") {
        onChange("");
      }
      return;
    }

    const seconds = parseDuration(inputValue);
    if (seconds !== null) {
      const totalMinutes = Math.round(seconds / 60);
      // Validate ranges (max 24:00 per day)
      if (totalMinutes <= 24 * 60) {
        const formatted = `${Math.floor(totalMinutes / 60)}:${String(totalMinutes % 60).padStart(2, "0")}`;
        setInputValue(formatted);
        if (formatted !== value) {
          onChange(formatted);
        }
        return;
      }
    }

    // Invalid input, revert to previous value
    setInputValue(value);
  };

  const handleFocus = () => {
    setIsFocused(true);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      (e.target as HTMLInputElement).blur();
    } else if (e.key === "Escape") {
      escapedRef.current = true;
      (e.target as HTMLInputElement).blur();
    }
  };

  return (
    <input
      type="text"
      value={inputValue}
      onChange={handleChange}
      onBlur={handleBlur}
      onFocus={handleFocus}
      onKeyDown={handleKeyDown}
      disabled={disabled}
      placeholder="0:00"
      title="H:MM, decimal hours (1.5) or minutes (45m)"
      className="w-16 px-2 py-1 text-center border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent disabled:bg-slate-100 disabled:cursor-not-allowed"
    />
  );
}
