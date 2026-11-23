export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export interface Database {
  public: {
    Tables: {
      matches: {
        Row: {
          id: string;
          tournament_id: string;
          status: string;
          team1_id: string | null;
          team2_id: string | null;
          round?: number | null;
          match_order?: number | null;
          next_match_id?: string | null;
          winner_id?: string | null;
          phase?: string | null;
          group_name?: string | null;
          score_a?: number | null;
          score_b?: number | null;
          sets_a?: number | null;
          sets_b?: number | null;
          penalties_a?: number | null;
          penalties_b?: number | null;
          details?: Json | null;
          detailed_score?: Json | null;
          set_history?: Json | null;
          sets_history?: Json | null;
          history?: Json | null;
          team_a_id?: string | null;
          team_b_id?: string | null;
          created_at?: string;
        };
        Insert: {
          id?: string;
          tournament_id: string;
          status?: string;
          team1_id?: string | null;
          team2_id?: string | null;
          round?: number | null;
          match_order?: number | null;
          next_match_id?: string | null;
          winner_id?: string | null;
          phase?: string | null;
          group_name?: string | null;
          score_a?: number | null;
          score_b?: number | null;
          sets_a?: number | null;
          sets_b?: number | null;
          penalties_a?: number | null;
          penalties_b?: number | null;
          details?: Json | null;
          detailed_score?: Json | null;
          set_history?: Json | null;
          sets_history?: Json | null;
          history?: Json | null;
          team_a_id?: string | null;
          team_b_id?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          tournament_id?: string;
          status?: string;
          team1_id?: string | null;
          team2_id?: string | null;
          round?: number | null;
          match_order?: number | null;
          next_match_id?: string | null;
          winner_id?: string | null;
          phase?: string | null;
          group_name?: string | null;
          score_a?: number | null;
          score_b?: number | null;
          sets_a?: number | null;
          sets_b?: number | null;
          penalties_a?: number | null;
          penalties_b?: number | null;
          details?: Json | null;
          detailed_score?: Json | null;
          set_history?: Json | null;
          sets_history?: Json | null;
          history?: Json | null;
          team_a_id?: string | null;
          team_b_id?: string | null;
          created_at?: string;
        };
      };
      tournaments: {
        Row: {
          id: string;
          name: string;
          status: string;
          owner_id: string;
          sport_type?: string | null;
          format?: string | null;
          tournament_format?: string | null;
          max_teams?: number | null;
          entry_fee?: number | null;
          location?: string | null;
          start_date?: string | null;
          start_time?: string | null;
          end_date?: string | null;
          rules?: string | null;
          rulebook_url?: string | null;
          regulation_url?: string | null;
          current_stage?: string | null;
          has_third_place_match?: boolean | null;
          created_at?: string;
        };
        Insert: {
          id?: string;
          name: string;
          status?: string;
          owner_id: string;
          sport_type?: string | null;
          format?: string | null;
          tournament_format?: string | null;
          max_teams?: number | null;
          entry_fee?: number | null;
          location?: string | null;
          start_date?: string | null;
          start_time?: string | null;
          end_date?: string | null;
          rules?: string | null;
          rulebook_url?: string | null;
          regulation_url?: string | null;
          current_stage?: string | null;
          has_third_place_match?: boolean | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          status?: string;
          owner_id?: string;
          sport_type?: string | null;
          format?: string | null;
          tournament_format?: string | null;
          max_teams?: number | null;
          entry_fee?: number | null;
          location?: string | null;
          start_date?: string | null;
          start_time?: string | null;
          end_date?: string | null;
          rules?: string | null;
          rulebook_url?: string | null;
          regulation_url?: string | null;
          current_stage?: string | null;
          has_third_place_match?: boolean | null;
          created_at?: string;
        };
      };
      teams: {
        Row: {
          id: string;
          tournament_id: string;
          name: string;
          captain_name?: string | null;
          captain_email?: string | null;
          captain_phone?: string | null;
          payment_status?: string | null;
          status?: string | null;
          cancellation_status?: string | null;
          amount_paid?: number | null;
          group_name?: string | null;
          created_at?: string;
        };
        Insert: {
          id?: string;
          tournament_id: string;
          name: string;
          captain_name?: string | null;
          captain_email?: string | null;
          captain_phone?: string | null;
          payment_status?: string | null;
          status?: string | null;
          cancellation_status?: string | null;
          amount_paid?: number | null;
          group_name?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          tournament_id?: string;
          name?: string;
          captain_name?: string | null;
          captain_email?: string | null;
          captain_phone?: string | null;
          payment_status?: string | null;
          status?: string | null;
          cancellation_status?: string | null;
          amount_paid?: number | null;
          group_name?: string | null;
          created_at?: string;
        };
      };
      team_members: {
        Row: {
          id: string;
          team_id: string;
          user_id?: string | null;
          email?: string | null;
          is_captain?: boolean | null;
          cpf?: string | null;
          phone?: string | null;
          tournament_id?: string | null;
          name?: string | null;
          role?: string | null;
          created_at?: string;
        };
        Insert: {
          id?: string;
          team_id: string;
          user_id?: string | null;
          email?: string | null;
          is_captain?: boolean | null;
          cpf?: string | null;
          phone?: string | null;
          tournament_id?: string | null;
          name?: string | null;
          role?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          team_id?: string;
          user_id?: string | null;
          email?: string | null;
          is_captain?: boolean | null;
          cpf?: string | null;
          phone?: string | null;
          tournament_id?: string | null;
          name?: string | null;
          role?: string | null;
          created_at?: string;
        };
      };
      tournament_staff: {
        Row: {
          id: string;
          tournament_id: string;
          user_id?: string | null;
          email?: string | null;
          role: string;
          status?: string | null;
          created_at?: string;
        };
        Insert: {
          id?: string;
          tournament_id: string;
          user_id?: string | null;
          email?: string | null;
          role: string;
          status?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          tournament_id?: string;
          user_id?: string | null;
          email?: string | null;
          role?: string;
          status?: string | null;
          created_at?: string;
        };
      };
    };
  };
}

