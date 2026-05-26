export interface ChangeLogEntry {
  id: string;
  timestamp: Date;
  tab: string;
  record: string;
  field: string;
  previousValue: string;
  newValue: string;
}

// Serialized version for storage (timestamp as ISO string)
export interface SerializedChangeLogEntry {
  id: string;
  timestamp: string;
  tab: string;
  record: string;
  field: string;
  previousValue: string;
  newValue: string;
}

export class ChangeLog {
  private entries: ChangeLogEntry[] = [];

  addEntry(
    tab: string,
    record: string,
    field: string,
    previousValue: string | number | null | undefined,
    newValue: string | number | null | undefined
  ): void {
    // Format values for display
    const formatValue = (value: string | number | null | undefined): string => {
      if (value === null || value === undefined) return "—";
      if (typeof value === "number") {
        // Format numbers with commas for amounts
        if (field.toLowerCase().includes("amount") || field.toLowerCase().includes("gst")) {
          return value.toLocaleString(undefined, {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          });
        }
        return String(value);
      }
      return String(value);
    };

    const formattedPrevious = formatValue(previousValue);
    const formattedNew = formatValue(newValue);

    // Only add entry if values actually changed
    if (formattedPrevious !== formattedNew) {
      this.entries.push({
        id: `${Date.now()}-${Math.random()}`,
        timestamp: new Date(),
        tab,
        record,
        field,
        previousValue: formattedPrevious,
        newValue: formattedNew,
      });
    }
  }

  getEntries(): ChangeLogEntry[] {
    return [...this.entries].reverse(); // Most recent first
  }

  clear(): void {
    this.entries = [];
  }

  getEntryCount(): number {
    return this.entries.length;
  }

  // Serialize entries for storage
  serialize(): SerializedChangeLogEntry[] {
    return this.entries.map((entry) => ({
      ...entry,
      timestamp: entry.timestamp.toISOString(),
    }));
  }

  // Deserialize entries from storage
  deserialize(serializedEntries: SerializedChangeLogEntry[]): void {
    this.entries = serializedEntries.map((entry) => ({
      ...entry,
      timestamp: new Date(entry.timestamp),
    }));
  }

  // Load entries from serialized data (replaces existing entries)
  load(serializedEntries: SerializedChangeLogEntry[]): void {
    this.clear();
    this.deserialize(serializedEntries);
  }
}

