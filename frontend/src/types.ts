export type Status =
  | "new"
  | "waiting_topic"
  | "waiting_review"
  | "completed";

export interface User {
  id: string;
  username: string;
  created_at: string;
}

export interface AuthResponse {
  access_token: string;
  token_type: string;
  user: User;
}

export interface TopicOption {
  title: string;
  angle: string;
  audience: string;
}

export interface Article {
  version: number;
  content: string;
  created_at: string;
}

export interface FinalPackage {
  title: string;
  summary: string;
  content: string;
  copy_text: string;
  tags: string[];
  image_prompts: string[];
  images: string[];
  image_generation_status?: "not_configured" | "completed" | "failed";
  image_generation_error?: string | null;
  publish_status: string;
}

export interface Project {
  id: string;
  source_topic: string;
  selected_topic: string | null;
  status: Status;
  topic_options: TopicOption[];
  latest_article: Article | null;
  final_package: FinalPackage | null;
  revision_count: number;
  created_at: string;
  updated_at: string;
}
