export interface TokenPayload {
    id: number;
    u_uuid: string;
    name: string;
    level: number;
    avatar: string | null;
    iat: number;
    exp: number;
}

export type VerifyTokenResult =
    | { valid: true; payload: TokenPayload }
    | { valid: false; error: string };
