// web/src/lib/supabase.ts
import "server-only";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;

// proteção extra: se alguém importar isso no client, explode
if (typeof window !== "undefined") {
  throw new Error("supabaseAdmin não pode rodar no client.");
}

if (!url) throw new Error("NEXT_PUBLIC_SUPABASE_URL is required.");
if (!serviceRole) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required.");

export const supabaseAdmin = createClient(url, serviceRole, {
  auth: { persistSession: false, autoRefreshToken: false },
});
