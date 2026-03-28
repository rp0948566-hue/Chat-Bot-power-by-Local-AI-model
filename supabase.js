import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://jkcafihelumneqdtssax.supabase.co';
const supabaseAnonKey = 'sb_publishable_-l_UuuLa5videlhibeLK_g_JjqtGXFY';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
