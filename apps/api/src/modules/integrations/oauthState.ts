import jwt from "jsonwebtoken";
import { JWT_SECRET } from "../../infra/env.js";

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
