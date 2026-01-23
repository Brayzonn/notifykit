export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface AuthResponse {
  user: {
    id: string;
    email: string;
    name: string;
    company: string | null;
    emailVerified: boolean;
    role: string;
    createdAt: Date;
    updatedAt: Date;
  };
  tokens: AuthTokens;
}

export interface GithubProfile {
  githubId: string;
  email: string;
  username: string;
  name: string;
  avatar?: string;
}
