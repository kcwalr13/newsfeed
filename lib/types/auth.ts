export interface DbUser {
  user_id: string;
  email: string;
  hashed_password: string;
  email_verified_at: Date | null;
  created_at: Date;
}

export interface DbSession {
  session_id: string;
  user_id: string;
  created_at: Date;
  last_active_at: Date;
  expires_at: Date;
}

export interface DbToken {
  token: string;
  user_id: string;
  purpose: 'email_verification' | 'password_reset';
  created_at: Date;
  expires_at: Date;
}

export interface AuthUser {
  userId: string;
  email: string;
}
