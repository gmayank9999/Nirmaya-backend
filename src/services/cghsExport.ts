import type { Archiver } from "archiver";
import { and, asc, eq } from "drizzle-orm";
import { patients } from "../schema/patients";
import { AppError } from "../types";
import { safeExtension, sanitizeFilenamePart } from "../utils/filename";
import { Db, displayPatientId } from "./exportData";
import { SchemeIndexRow, buildSchemeIndexXlsx } from "./exportXlsx";

export type Scheme = "cghs" | "echs";

// Everything that differs between the CGHS and ECHS bulk exports.
export const SCHEMES = {
  cghs: {
    label: "CGHS",
    folder: "cghs",
    flag: patients.hasCghs,
    url: patients.cghsFileUrl,
  },
  echs: {
    label: "ECHS",
    folder: "echs",
    flag: patients.hasEchs,
    url: patients.echsFileUrl,
  },
} as const;

// Limits sized for a 30s serverless function; exceeding them degrades gracefully (see writeCghsZip).
export const MAX_CGHS_PATIENTS = 300;
export const MAX_CGHS_TOTAL_BYTES = 80 * 1024 * 1024;
export const CGHS_TIME_BUDGET_MS = 22_000;
const DOWNLOAD_CONCURRENCY = 4;

export class StorageObjectNotFound extends Error {}

export type StorageDownloader = (objectPath: string) => Promise<Buffer>;

export interface SchemePatient {
  id: string;
  patientNumber: number | null;
  name: string;
  phone: string;
  fileUrl: string | null;
}

export const listSchemePatients = async (
  db: Db,
  clinicId: string,
  scheme: Scheme
): Promise<SchemePatient[]> => {
  const cfg = SCHEMES[scheme];
  const rows = await db
    .select({
      id: patients.id,
      patientNumber: patients.patientNumber,
      name: patients.name,
      phone: patients.phone,
      fileUrl: cfg.url,
    })
    .from(patients)
    .where(and(eq(patients.clinicId, clinicId), eq(cfg.flag, true), eq(patients.isActive, true)))
    .orderBy(asc(patients.patientNumber), asc(patients.id));

  if (rows.length === 0) {
    throw new AppError(
      404,
      `No ${cfg.label} records`,
      `No active patients with ${cfg.label} documents were found`
    );
  }
  if (rows.length > MAX_CGHS_PATIENTS) {
    throw new AppError(
      413,
      "Export too large",
      `More than ${MAX_CGHS_PATIENTS} ${cfg.label} patients; this export is limited to ${MAX_CGHS_PATIENTS}.`
    );
  }
  return rows;
};

/**
 * Converts a stored public URL back into a storage object path, accepting only
 * objects inside the configured bucket, on the configured Supabase host, under
 * this clinic + patient's scheme folder (`cghs` or `echs`). Returns null for anything else, so a
 * tampered/foreign URL is never fetched (no SSRF, no cross-clinic reads).
 */
export const resolveSchemeStoragePath = (params: {
  scheme?: Scheme;
  url: string;
  supabaseUrl: string;
  bucket: string;
  clinicId: string;
  patientId: string;
}): string | null => {
  let parsed: URL;
  let base: URL;
  try {
    parsed = new URL(params.url);
    base = new URL(params.supabaseUrl);
  } catch {
    return null;
  }
  if (parsed.origin !== base.origin) return null;

  const prefix = `/storage/v1/object/public/${params.bucket}/`;
  if (!parsed.pathname.startsWith(prefix)) return null;

  let objectPath: string;
  try {
    objectPath = decodeURIComponent(parsed.pathname.slice(prefix.length));
  } catch {
    return null;
  }

  const segments = objectPath.split("/");
  if (segments.some((s) => s === "" || s === "." || s === ".." || s.includes("\\"))) return null;
  const expected = [
    `clinic-${params.clinicId}`,
    "patients",
    params.patientId,
    SCHEMES[params.scheme ?? "cghs"].folder,
  ];
  if (segments.length !== 5 || expected.some((part, i) => segments[i] !== part)) return null;
  return objectPath;
};

// Uploads are stored as `<timestamp>-<originalName>`; recover the original extension.
const originalFileName = (objectPath: string) => {
  const last = objectPath.split("/").pop() ?? "";
  return last.replace(/^\d+-/, "");
};

export const createSupabaseDownloader = (
  storage: {
    from: (bucket: string) => {
      download: (path: string) => Promise<{ data: Blob | null; error: any }>;
    };
  },
  bucket: string
): StorageDownloader => {
  return async (objectPath) => {
    const { data, error } = await storage.from(bucket).download(objectPath);
    if (error || !data) {
      const message = String(error?.message ?? "");
      if (error?.statusCode === "404" || error?.status === 404 || /not found/i.test(message)) {
        throw new StorageObjectNotFound(message);
      }
      throw new Error(message || "Storage download failed");
    }
    return Buffer.from(await data.arrayBuffer());
  };
};

export const writeSchemeZip = async (params: {
  scheme?: Scheme;
  archive: Archiver;
  eligible: SchemePatient[];
  clinicId: string;
  supabaseUrl: string;
  bucket: string;
  download: StorageDownloader;
  now?: () => number;
  exportDate?: Date;
}): Promise<SchemeIndexRow[]> => {
  const { archive, eligible, clinicId, supabaseUrl, bucket, download } = params;
  const scheme = params.scheme ?? "cghs";
  const { label } = SCHEMES[scheme];
  const now = params.now ?? Date.now;
  const deadline = now() + CGHS_TIME_BUDGET_MS;
  const usedFolders = new Set<string>();
  const index: SchemeIndexRow[] = [];
  let totalBytes = 0;

  const folderFor = (p: SchemePatient) => {
    const base = `${displayPatientId(p.patientNumber, p.id)}_${sanitizeFilenamePart(p.name, "patient")}`;
    const folder = usedFolders.has(base) ? `${base}_${p.id.slice(0, 8)}` : base;
    usedFolders.add(folder);
    return folder;
  };

  const processOne = async (p: SchemePatient) => {
    const row: SchemeIndexRow = {
      patientId: p.id,
      patientNumber: p.patientNumber,
      patientDisplayId: displayPatientId(p.patientNumber, p.id),
      name: p.name,
      phone: p.phone,
      available: true,
      status: "",
      fileName: "",
    };
    const folder = folderFor(p);

    if (!p.fileUrl) {
      row.status = `Missing - no ${label} file uploaded`;
      return { row };
    }
    const objectPath = resolveSchemeStoragePath({
      scheme,
      url: p.fileUrl,
      supabaseUrl,
      bucket,
      clinicId,
      patientId: p.id,
    });
    if (!objectPath) {
      row.status = `Failed - stored file location is not a valid ${label} file path`;
      return { row };
    }
    if (now() > deadline || totalBytes >= MAX_CGHS_TOTAL_BYTES) {
      row.status = "Skipped - export size/time limit reached";
      return { row };
    }
    try {
      const buffer = await download(objectPath);
      totalBytes += buffer.length;
      row.fileName = `${label}_Card${safeExtension(originalFileName(objectPath))}`;
      row.status = "Downloaded";
      return { row, entry: { name: `${label}/${folder}/${row.fileName}`, buffer } };
    } catch (error) {
      if (error instanceof StorageObjectNotFound) {
        row.status = "Missing - file not found in storage";
      } else {
        console.error(`[${label} export] download failed for patient`, p.id, error);
        row.status = "Failed - could not download from storage";
      }
      return { row };
    }
  };

  for (let i = 0; i < eligible.length; i += DOWNLOAD_CONCURRENCY) {
    const results = await Promise.all(eligible.slice(i, i + DOWNLOAD_CONCURRENCY).map(processOne));
    for (const { row, entry } of results) {
      index.push(row);
      if (entry) archive.append(entry.buffer, { name: entry.name });
    }
  }

  archive.append(await buildSchemeIndexXlsx(index, params.exportDate ?? new Date(), label), {
    name: `${label}_Patient_Index.xlsx`,
  });
  await archive.finalize();
  return index;
};
