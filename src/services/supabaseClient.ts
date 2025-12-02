import dotenv from "dotenv";
dotenv.config();
// import { createClient } from '@supabase/supabase-js';
// import { dot } from "node:test/reporters";

// const supabaseUrl = process.env.SUPABASE_URL!;
// const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// export const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export const supabaseServer = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: { persistSession: false },
});
