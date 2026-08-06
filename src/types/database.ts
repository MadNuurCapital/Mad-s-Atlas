/**
 * Supabase database types.
 *
 * PHASE 1 PLACEHOLDER. The real file is generated from the live schema in
 * Phase 2 and overwrites this one:
 *
 *     npm run db:types
 *
 * Until then this shape lets the Supabase clients type-check without asserting
 * a schema that does not yet exist. It is deliberately empty rather than a
 * hand-written guess that would drift from the migrations.
 */

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: Record<
      string,
      {
        Row: Record<string, Json>;
        Insert: Record<string, Json>;
        Update: Record<string, Json>;
        Relationships: [];
      }
    >;
    Views: Record<
      string,
      {
        Row: Record<string, Json>;
        Relationships: [];
      }
    >;
    Functions: Record<string, { Args: Record<string, Json>; Returns: Json }>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
