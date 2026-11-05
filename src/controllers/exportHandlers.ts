import db from "../config/db";
import { env } from "../config/env";
import { supabase } from "../config/supabase";
import { createSupabaseDownloader } from "../services/cghsExport";
import { makeExportHandlers } from "./exports";

// Production wiring for the export controllers (real database + Supabase Storage).
export default makeExportHandlers({
  db,
  supabaseUrl: env.SUPABASE_URL,
  bucket: env.SUPABASE_STORAGE_BUCKET,
  download: createSupabaseDownloader(supabase.storage as any, env.SUPABASE_STORAGE_BUCKET),
});
