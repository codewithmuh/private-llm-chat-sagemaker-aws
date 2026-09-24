/**
 * Shapes of the objects the Django API returns. They mirror docs/api.md one to
 * one; if the backend changes a field, change it here and let TypeScript show
 * every place that needs updating.
 */

export type ThemePreference = "system" | "light" | "dark";

/** GET /api/config/ */
export interface AppConfig {
  app_name: string;
  google_client_id: string | null;
  signup_enabled: boolean;
  email_verification: "mandatory" | "optional" | "none";
  max_upload_mb: number;
  accepted_file_types: string[];
}

export interface MfaStatus {
  enabled: boolean;
  totp: boolean;
  email: boolean;
  recovery_codes_remaining: number;
}

export interface UserPreferences {
  default_model: string | null;
  custom_instructions: string;
  theme: ThemePreference;
}

export interface User {
  id: string;
  email: string;
  name: string;
  avatar_url: string | null;
  email_verified: boolean;
  has_password: boolean;
  google_linked: boolean;
  is_staff: boolean;
  mfa: MfaStatus;
  preferences: UserPreferences;
  date_joined: string;
}

export type MfaMethod = "totp" | "email" | "recovery";

/** What login/, google/ and verify-email/ answer with. */
export type LoginResponse =
  | { status: "ok"; user: User }
  | { status: "mfa_required"; methods: MfaMethod[] };

export type SignupResponse =
  | { status: "verification_required"; email: string }
  | { status: "ok"; user: User };

export type ModelStatus = "ready" | "starting" | "stopped" | "failed" | "unknown";

export interface Model {
  id: string;
  name: string;
  description: string;
  provider: "sagemaker" | "openai" | "mock";
  vision: boolean;
  ocr: boolean;
  context_window: number | null;
  is_default: boolean;
  status: ModelStatus;
  status_detail: string;
}

export interface Conversation {
  id: string;
  title: string;
  model: string | null;
  pinned: boolean;
  system_prompt: string;
  created_at: string;
  updated_at: string;
}

export interface ConversationDetail extends Conversation {
  messages: Message[];
}

export type MessageStatus = "complete" | "streaming" | "stopped" | "error";

export interface Usage {
  prompt_tokens: number;
  completion_tokens: number;
}

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  model: string | null;
  status: MessageStatus;
  error: string | null;
  attachments: Attachment[];
  usage: Usage | null;
  duration_ms: number | null;
  created_at: string;
}

export interface Attachment {
  id: string;
  filename: string;
  content_type: string;
  size: number;
  kind: "image" | "document";
  status: "ready" | "error";
  error: string | null;
  page_count: number | null;
  has_text: boolean;
  text_chars: number | null;
  text_preview: string | null;
  ocr_done: boolean;
  url: string;
  created_at: string;
}

/** POST /api/files/{id}/ocr/ */
export interface OcrResult {
  text: string;
  engine: string;
  duration_ms: number;
  attachment: Attachment;
}

export interface TotpSetup {
  secret: string;
  otpauth_url: string;
  qr_svg: string;
}

/* ---------------------------------------------------------------- stream */

/** Codes an `error` stream event can carry. */
export type StreamErrorCode =
  | "provider_error"
  | "model_starting"
  | "model_unavailable"
  | "context_too_long";

/** Every event the chat stream can send, keyed by its `event:` name. */
export type ChatStreamEvent =
  | { event: "start"; data: { user_message: Message | null; assistant_message: Message } }
  | { event: "delta"; data: { content: string } }
  | { event: "done"; data: { message: Message } }
  | { event: "title"; data: { conversation_id: string; title: string } }
  | { event: "error"; data: { code: StreamErrorCode | string; error: string; message?: Message } };
