import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET ?? "dev-secret-change-me";

interface OAuthState {
  workspaceId: string;
}

/** Short-lived signed state param shared by every ad-platform OAuth flow (Meta, Google, ...). */
export function signOAuthState(workspaceId: string): string {
  return jwt.sign({ workspaceId } as OAuthState, JWT_SECRET, { expiresIn: "10m" });
}

export function verifyOAuthState(state: string): OAuthState {
  return jwt.verify(state, JWT_SECRET) as OAuthState;
}
