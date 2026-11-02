/**
 * RFC 4180 compliant CSV serializer with UTF-8 BOM encoding for Microsoft Excel compatibility.
 */

export interface CsvColumn<T = any> {
  header: string;
  accessor: keyof T | ((row: T) => any);
}

export function escapeCsvField(value: any): string {
  if (value === null || value === undefined) {
    return "";
  }
  let str = String(value);

  // If date object, format to ISO string or readable date
  if (value instanceof Date) {
    str = value.toISOString();
  }

  // If string contains comma, quote, or newline, escape it
  if (str.includes('"') || str.includes(",") || str.includes("\n") || str.includes("\r")) {
    return `"${str.replace(/"/g, '""')}"`;
  }

  return str;
}

export function serializeToCsv<T>(data: T[], columns: CsvColumn<T>[]): string {
  // UTF-8 BOM
  const BOM = "\uFEFF";

  const headers = columns.map((col) => escapeCsvField(col.header)).join(",");

  const rows = data.map((row) => {
    return columns
      .map((col) => {
        let rawVal: any;
        if (typeof col.accessor === "function") {
          rawVal = col.accessor(row);
        } else {
          rawVal = row[col.accessor];
        }
        return escapeCsvField(rawVal);
      })
      .join(",");
  });

  return `${BOM}${headers}\r\n${rows.join("\r\n")}`;
}
