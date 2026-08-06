/**
 * Supabase database types for Mad's Atlas.
 *
 * Hand-derived from supabase/migrations/. Once a Supabase project is linked,
 * regenerate from the live schema — that becomes the source of truth and this
 * file is overwritten:
 *
 *     npm run db:types
 *
 * Until then these are kept in step with the migrations by hand. If you change
 * a migration, change this file in the same commit (CLAUDE.md § Phase
 * discipline).
 */

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

/* -------------------------------------------------------------------------- */
/*  Domain unions — mirror the CHECK constraints                               */
/* -------------------------------------------------------------------------- */

export type MemoryCategory =
  | 'profile'
  | 'preference'
  | 'goal'
  | 'routine'
  | 'important_person'
  | 'project'
  | 'commitment'
  | 'decision'
  | 'idea_reference'
  | 'temporary_context';

export type MemoryStatus = 'suggested' | 'confirmed' | 'superseded' | 'expired' | 'deleted';
export type Sensitivity = 'normal' | 'personal' | 'sensitive' | 'highly_sensitive';
export type MemorySource = 'voice' | 'text' | 'email' | 'calendar' | 'research' | 'manual' | 'system';

export type TaskStatus = 'inbox' | 'planned' | 'in_progress' | 'waiting' | 'completed' | 'cancelled';
export type TaskPriority = 'low' | 'normal' | 'high' | 'critical';
export type TaskSource = 'manual' | 'voice' | 'email' | 'briefing' | 'idea';

export type ReminderStatus = 'scheduled' | 'triggered' | 'acknowledged' | 'disabled' | 'completed';
export type DeliveryChannel = 'push' | 'in_app' | 'calendar';

export type IdeaStatus =
  | 'captured'
  | 'exploring'
  | 'planned'
  | 'building'
  | 'completed'
  | 'parked'
  | 'archived';

export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'expired' | 'executed' | 'failed';
export type OperationType = 'read' | 'analyse' | 'propose' | 'execute' | 'refuse';
export type ActionStatus = 'success' | 'failure' | 'refused' | 'timeout';
export type ToolRunStatus = 'running' | 'succeeded' | 'failed' | 'cancelled' | 'timeout';

export type ConversationChannel = 'voice' | 'text' | 'system' | 'scheduled';
export type MessageRole = 'user' | 'assistant' | 'system' | 'tool';

export type ConnectionStatus = 'connected' | 'needs_reconnection' | 'revoked' | 'error';
export type BriefingStatus = 'generating' | 'ready' | 'delivered' | 'failed';
export type ResearchDetailLevel = 'brief' | 'standard' | 'detailed';

/* -------------------------------------------------------------------------- */
/*  Row shapes                                                                 */
/* -------------------------------------------------------------------------- */

type Timestamps = { created_at: string; updated_at: string };

export type Profile = Timestamps & {
  id: string;
  user_id: string;
  email: string;
  display_name: string | null;
  preferred_name: string | null;
  timezone: string;
  locale: string;
  default_voice: string | null;
  briefing_time: string;
  briefing_enabled: boolean;
};

export type UserSettings = Timestamps & {
  id: string;
  user_id: string;
  memory_enabled: boolean;
  proactive_briefings_enabled: boolean;
  email_summary_enabled: boolean;
  calendar_preparation_enabled: boolean;
  notification_enabled: boolean;
  conversation_retention_days: number;
  research_detail_level: ResearchDetailLevel;
  approval_expiry_minutes: number;
  meeting_prep_lead_minutes: number;
};

/**
 * Safe projection of connected_accounts. The encrypted token columns are not
 * present here and must never be added — clients read this view, and the
 * column-level grants make the base table's token columns unreachable anyway.
 */
export type ConnectedAccountStatus = Timestamps & {
  id: string;
  user_id: string;
  provider: 'google';
  email: string;
  granted_scopes: string[];
  connection_status: ConnectionStatus;
  access_token_expires_at: string | null;
  last_refreshed_at: string | null;
};

export type Memory = Timestamps & {
  id: string;
  user_id: string;
  title: string;
  content: string;
  category: MemoryCategory;
  structured_data: Json;
  status: MemoryStatus;
  confidence: number;
  sensitivity: Sensitivity;
  source_type: MemorySource;
  source_reference: string | null;
  confirmed_at: string | null;
  last_confirmed_at: string | null;
  expires_at: string | null;
  superseded_by: string | null;
  embedding_attempts: number;
  deleted_at: string | null;
};

export type MemoryVersion = {
  id: string;
  memory_id: string;
  user_id: string;
  previous_content: string;
  previous_structured_data: Json;
  change_reason: string | null;
  changed_by: 'user' | 'atlas';
  created_at: string;
};

export type Task = Timestamps & {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  due_at: string | null;
  start_at: string | null;
  completed_at: string | null;
  source: TaskSource;
  related_project: string | null;
  recurrence_rule: string | null;
  google_calendar_event_id: string | null;
  deleted_at: string | null;
};

export type Reminder = Timestamps & {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  remind_at: string;
  recurrence_rule: string | null;
  timezone: string;
  delivery_channel: DeliveryChannel;
  status: ReminderStatus;
  related_task_id: string | null;
  google_calendar_event_id: string | null;
  last_triggered_at: string | null;
  next_trigger_at: string | null;
};

export type Idea = Timestamps & {
  id: string;
  user_id: string;
  title: string;
  original_capture: string;
  summary: string | null;
  category: string | null;
  status: IdeaStatus;
  next_action: string | null;
  structured_plan: Json;
  archived_at: string | null;
};

export type Approval = Timestamps & {
  id: string;
  user_id: string;
  action_type: string;
  title: string;
  reason: string;
  proposed_payload: Json;
  payload_hash: string;
  affected_data: Json;
  status: ApprovalStatus;
  idempotency_key: string;
  requested_at: string;
  expires_at: string;
  approved_at: string | null;
  rejected_at: string | null;
  executed_at: string | null;
  execution_result: Json | null;
  supersedes_approval_id: string | null;
};

export type ActionLog = {
  id: string;
  user_id: string;
  session_id: string | null;
  tool_name: string;
  operation_type: OperationType;
  action_summary: string;
  status: ActionStatus;
  approval_id: string | null;
  duration_ms: number | null;
  error_code: string | null;
  metadata: Json;
  created_at: string;
};

export type ToolRun = {
  id: string;
  user_id: string;
  conversation_id: string | null;
  tool_name: string;
  input_summary: string | null;
  output_summary: string | null;
  status: ToolRunStatus;
  started_at: string;
  completed_at: string | null;
  error_code: string | null;
  retry_count: number;
  created_at: string;
};

export type Conversation = Timestamps & {
  id: string;
  user_id: string;
  title: string | null;
  channel: ConversationChannel;
  started_at: string;
  ended_at: string | null;
  summary: string | null;
  retention_until: string | null;
};

export type ConversationMessage = {
  id: string;
  conversation_id: string;
  user_id: string;
  role: MessageRole;
  content: string;
  tool_call_metadata: Json;
  created_at: string;
  retention_until: string;
};

export type ResearchReport = {
  id: string;
  user_id: string;
  query: string;
  summary: string;
  why_it_matters: string | null;
  structured_result: Json;
  searched_at: string;
  created_at: string;
};

export type ResearchSource = {
  id: string;
  research_report_id: string;
  user_id: string;
  title: string;
  publisher: string | null;
  source_url: string;
  publication_date: string | null;
  accessed_at: string;
  relevance_score: number | null;
  created_at: string;
};

export type DailyBriefing = Timestamps & {
  id: string;
  user_id: string;
  briefing_date: string;
  timezone: string;
  calendar_summary: Json;
  email_summary: Json;
  task_summary: Json;
  market_summary: Json;
  technology_summary: Json;
  recommended_priority: string | null;
  full_briefing: string | null;
  generated_at: string | null;
  delivered_at: string | null;
  status: BriefingStatus;
};

export type NotificationSubscriptionStatus = Timestamps & {
  id: string;
  user_id: string;
  user_agent: string | null;
  enabled: boolean;
};

/* -------------------------------------------------------------------------- */
/*  Supabase client shape                                                      */
/* -------------------------------------------------------------------------- */

type Table<Row, Insert = Partial<Row>, Update = Partial<Row>> = {
  Row: Row;
  Insert: Insert;
  Update: Update;
  Relationships: [];
};

export type Database = {
  public: {
    Tables: {
      profiles: Table<Profile>;
      user_settings: Table<UserSettings>;
      memories: Table<Memory>;
      memory_versions: Table<MemoryVersion>;
      tasks: Table<Task>;
      reminders: Table<Reminder>;
      ideas: Table<Idea>;
      approvals: Table<Approval>;
      action_logs: Table<ActionLog>;
      tool_runs: Table<ToolRun>;
      conversations: Table<Conversation>;
      conversation_messages: Table<ConversationMessage>;
      research_reports: Table<ResearchReport>;
      research_sources: Table<ResearchSource>;
      daily_briefings: Table<DailyBriefing>;
      // Insert/Update are intentionally loose here: the token columns are
      // bytea, written as `\x…` hex strings by the server-side client only.
      connected_accounts: Table<Record<string, Json>, Record<string, Json>, Record<string, Json>>;
      notification_subscriptions: Table<Record<string, Json>>;
    };
    Views: {
      connected_account_status: { Row: ConnectedAccountStatus; Relationships: [] };
      notification_subscription_status: {
        Row: NotificationSubscriptionStatus;
        Relationships: [];
      };
    };
    Functions: {
      claim_approval: {
        Args: { p_approval_id: string; p_idempotency_key: string };
        Returns: Approval;
      };
      search_memories_hybrid: {
        Args: {
          p_query: string;
          p_embedding?: string | null;
          p_categories?: MemoryCategory[] | null;
          p_limit?: number;
          p_include_sensitive?: boolean;
        };
        Returns: Array<{
          id: string;
          title: string;
          content: string;
          category: MemoryCategory;
          sensitivity: Sensitivity;
          confidence: number;
          score: number;
          vector_similarity: number;
          text_rank: number;
          confirmed_at: string | null;
          updated_at: string;
        }>;
      };
      search_memories_semantic: {
        Args: { p_embedding: string; p_limit?: number; p_min_similarity?: number };
        Returns: Array<{
          id: string;
          title: string;
          content: string;
          category: MemoryCategory;
          sensitivity: Sensitivity;
          confidence: number;
          similarity: number;
          confirmed_at: string | null;
        }>;
      };
      get_today_agenda: {
        Args: { p_timezone?: string };
        Returns: Array<{
          kind: 'task' | 'reminder';
          id: string;
          title: string;
          at_time: string | null;
          priority: TaskPriority | null;
          status: string;
        }>;
      };
      get_overdue_tasks: {
        Args: { p_limit?: number };
        Returns: Array<{
          id: string;
          title: string;
          priority: TaskPriority;
          due_at: string;
          status: TaskStatus;
        }>;
      };
      export_all_user_data: { Args: Record<string, never>; Returns: Json };
      delete_all_user_data: { Args: Record<string, never>; Returns: Json };
      is_owner: { Args: Record<string, never>; Returns: boolean };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };

  /**
   * Not exposed through the Data API — reachable only with the secret key.
   * Declared here so `admin.schema('private')` type-checks; a client using the
   * publishable key cannot reach it whatever the types say.
   */
  private: {
    Tables: {
      allowed_users: Table<{
        email: string;
        enabled: boolean;
        created_at: string;
        updated_at: string;
      }>;
      job_runs: Table<{
        id: string;
        job_name: string;
        run_key: string;
        status: 'running' | 'succeeded' | 'failed' | 'skipped';
        started_at: string;
        completed_at: string | null;
        duration_ms: number | null;
        error_code: string | null;
        details: Json;
      }>;
    };
    Views: {
      job_status: {
        Row: {
          job_name: string;
          status: string;
          started_at: string;
          completed_at: string | null;
          duration_ms: number | null;
          error_code: string | null;
        };
        Relationships: [];
      };
    };
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
