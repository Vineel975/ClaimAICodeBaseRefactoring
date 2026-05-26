"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ChangeLogEntry } from "@/src/changelog";

interface ChangeLogTabProps {
  fileName: string;
  entries: ChangeLogEntry[];
}

export function ChangeLogTab({ fileName, entries }: ChangeLogTabProps) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
        <div>
          <CardTitle>Change Log</CardTitle>
        </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {entries.length === 0 ? (
          <div className="flex h-32 items-center justify-center rounded-lg border border-dashed bg-muted/40 text-sm text-muted-foreground">
            No changes recorded yet.
          </div>
        ) : (
          <div className="rounded-md border bg-white">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>TIME</TableHead>
                  <TableHead>TAB</TableHead>
                  <TableHead>RECORD</TableHead>
                  <TableHead>FIELD</TableHead>
                  <TableHead>PREVIOUS VALUE</TableHead>
                  <TableHead>NEW VALUE</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((entry) => {
                  const timeStr = entry.timestamp.toLocaleTimeString("en-GB", {
                    hour: "2-digit",
                    minute: "2-digit",
                  });
                  const dateStr = entry.timestamp.toLocaleDateString("en-GB", {
                    day: "2-digit",
                    month: "2-digit",
                    year: "numeric",
                  });
                  return (
                    <TableRow key={entry.id}>
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="font-medium">{timeStr}</span>
                          <span className="text-xs text-gray-500">{dateStr}</span>
                        </div>
                      </TableCell>
                      <TableCell>{entry.tab}</TableCell>
                      <TableCell>{entry.record}</TableCell>
                      <TableCell>{entry.field}</TableCell>
                      <TableCell>{entry.previousValue}</TableCell>
                      <TableCell>{entry.newValue}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
