// Turns arbitrary text (patient names, etc.) into a safe single path segment.
// Removes path separators, control/invalid filesystem characters and "..".
export const sanitizeFilenamePart = (value: string, fallback = "file"): string => {
  const cleaned = value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ")
    .replace(/\.{2,}/g, ".")
    .replace(/\s+/g, "_")
    .replace(/[^A-Za-z0-9._-]/g, "")
    .replace(/^[._-]+|[._-]+$/g, "")
    .slice(0, 80);
  return cleaned || fallback;
};

// "04 Nov 2026" style date used in report filenames (clinic works in IST).
export const istDateStamp = (date: Date = new Date()): string =>
  new Date(date.getTime() + 330 * 60 * 1000).toISOString().slice(0, 10);

// Extension (with dot) of an uploaded file name, limited to a conservative set
// of characters. Returns "" when there isn't a usable one.
export const safeExtension = (fileName: string): string => {
  const match = /\.([A-Za-z0-9]{1,5})$/.exec(fileName);
  return match ? `.${match[1].toLowerCase()}` : "";
};
