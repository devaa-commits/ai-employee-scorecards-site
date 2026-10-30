// Empty for the local app (it reads /api/*). The Pages deploy overwrites this with the Supabase URL
// and publishable key, which are safe to expose: the tables only answer vendasta.com Google sign-ins.
window.SCORECARDS = { supabaseUrl: "", supabaseKey: "" };
