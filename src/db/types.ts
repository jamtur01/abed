export type RequestStatus = 'pending' | 'submitting' | 'uncertain' | 'approved' | 'rejected' | 'already_exists' | 'failed';
export type Platform = 'slack' | 'discord';

export type MovieRequest = {
  id: number;
  movie_title: string;
  tmdb_id: number;
  imdb_id: string | null;
  year: number;
  poster_url: string | null;
  requester_slack_id: string;
  approver_slack_id: string | null;
  status: RequestStatus;
  approval_channel_id: string | null;
  slack_message_ts: string | null; // timestamp of approval message in Slack OR Discord message ID
  downloaded_notified: number; // 0 = not notified, 1 = notified
  platform: Platform; // 'slack' or 'discord'
  created_at: string; // ISO timestamp
  updated_at: string; // ISO timestamp
};

export type CreateRequestInput = {
  movie_title: string;
  tmdb_id: number;
  imdb_id?: string | null;
  year: number;
  poster_url?: string | null;
  requester_slack_id: string; // We keep the property name for backwards compatibility but it can hold a Discord ID
  approval_channel_id?: string;
  slack_message_ts?: string | null;
  platform?: Platform; // Defaults to 'slack'
};

export type UpdateRequestStatusInput = {
  id: number;
  status: RequestStatus;
  approver_slack_id?: string;
  slack_message_ts?: string;
};

export type TvRequest = {
  id: number;
  show_title: string;
  tvdb_id: number;
  year: number;
  poster_url: string | null;
  requester_slack_id: string;
  approver_slack_id: string | null;
  status: RequestStatus;
  approval_channel_id: string | null;
  slack_message_ts: string | null;
  downloaded_notified: number; // 0 = not notified, 1 = notified
  platform: Platform;
  created_at: string;
  updated_at: string;
};

export type CreateTvRequestInput = {
  show_title: string;
  tvdb_id: number;
  year: number;
  poster_url?: string | null;
  requester_slack_id: string;
  approval_channel_id?: string;
  slack_message_ts?: string | null;
  platform?: Platform;
};

export type UpdateTvRequestStatusInput = {
  id: number;
  status: RequestStatus;
  approver_slack_id?: string;
  slack_message_ts?: string;
};
