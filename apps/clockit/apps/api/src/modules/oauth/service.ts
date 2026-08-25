import { prisma } from "../../lib/prisma";
import { OAuth2Client } from "google-auth-library";
import jwt from "jsonwebtoken";
import jwksClient from "jwks-rsa";
import env from "../../config";
import { DEFAULT_NOTIFICATION_PREFS } from "../notifications/service";

const googleClient = new OAuth2Client(env.GOOGLE_CLIENT_ID);

// Apple's public keys endpoint for JWT verification
const appleJwks = jwksClient({
  jwksUri: "https://appleid.apple.com/auth/keys",
});

function getAppleSigningKey(kid: string): Promise<string> {
  return new Promise((resolve, reject) => {
    appleJwks.getSigningKey(kid, (err, key) => {
      if (err || !key) return reject(err || new Error("No key"));
      resolve(key.getPublicKey());
    });
  });
}

export interface OAuthUserInfo {
  email: string;
  name: string;
  avatarUrl?: string;
  provider: "google" | "microsoft" | "apple";
  providerId: string;
}

export class OAuthService {
  /**
   * REQ-LI-B09: Validate Google ID token and extract user info
   */
  static async verifyGoogleToken(idToken: string): Promise<OAuthUserInfo> {
    try {
      const ticket = await googleClient.verifyIdToken({
        idToken,
        audience: env.GOOGLE_CLIENT_ID,
      });
      const payload = ticket.getPayload();
      if (!payload || !payload.email) {
        throw new Error("Invalid Google token payload");
      }
      if (!payload.email_verified) {
        throw new Error("Google email not verified");
      }
      return {
        email: payload.email.toLowerCase(),
        name: payload.name || payload.email.split("@")[0],
        avatarUrl: payload.picture,
        provider: "google",
        providerId: payload.sub,
      };
    } catch (error: any) {
      await this.logFailedAttempt("google", null, error.message);
      throw new Error(`Google OAuth failed: ${error.message}`);
    }
  }

  /**
   * REQ-LI-B10: Validate Microsoft OIDC token
   */
  static async verifyMicrosoftToken(idToken: string): Promise<OAuthUserInfo> {
    try {
      // Decode without verification first to get the header
      const decoded = jwt.decode(idToken, { complete: true }) as any;
      if (!decoded || !decoded.header || !decoded.payload) {
        throw new Error("Invalid Microsoft token format");
      }
      // Fetch Microsoft's public keys
      const tenant = env.MICROSOFT_TENANT;
      const jwksUrl = `https://login.microsoftonline.com/${tenant}/discovery/v2.0/keys`;
      const response = await fetch(jwksUrl);
      const jwks = (await response.json()) as any;
      const key = jwks.keys.find((k: any) => k.kid === decoded.header.kid);
      if (!key) {
        throw new Error("Microsoft signing key not found");
      }
      // Convert JWK to PEM and verify
      const pem = this.jwkToPem(key);
      const payload = jwt.verify(idToken, pem, {
        algorithms: ["RS256"],
        audience: env.MICROSOFT_CLIENT_ID,
        issuer: [
          `https://login.microsoftonline.com/${tenant}/v2.0`,
          `https://sts.windows.net/${tenant}/`,
        ],
      }) as any;
      if (!payload.email && !payload.preferred_username) {
        throw new Error("Microsoft token missing email");
      }
      const email = (payload.email || payload.preferred_username).toLowerCase();
      return {
        email,
        name: payload.name || email.split("@")[0],
        avatarUrl: undefined,
        provider: "microsoft",
        providerId: payload.oid || payload.sub,
      };
    } catch (error: any) {
      await this.logFailedAttempt("microsoft", null, error.message);
      throw new Error(`Microsoft OAuth failed: ${error.message}`);
    }
  }

  /**
   * REQ-LI-B11: Validate Apple signed JWT against Apple's public keys
   */
  static async verifyAppleToken(identityToken: string): Promise<OAuthUserInfo> {
    try {
      const decoded = jwt.decode(identityToken, { complete: true }) as any;
      if (!decoded || !decoded.header) {
        throw new Error("Invalid Apple token format");
      }
      // Verify issuer and audience
      if (decoded.payload.iss !== "https://appleid.apple.com") {
        throw new Error("Invalid Apple issuer");
      }
      if (decoded.payload.aud !== env.APPLE_CLIENT_ID) {
        throw new Error("Invalid Apple audience");
      }
      // Get Apple's public key
      const publicKey = await getAppleSigningKey(decoded.header.kid);
      // Verify signature
      const payload = jwt.verify(identityToken, publicKey, {
        algorithms: ["RS256"],
      }) as any;
      if (!payload.email) {
        throw new Error("Apple token missing email");
      }
      return {
        email: payload.email.toLowerCase(),
        name: payload.name
          ? `${payload.name.firstName || ""} ${payload.name.lastName || ""}`.trim()
          : payload.email.split("@")[0],
        avatarUrl: undefined,
        provider: "apple",
        providerId: payload.sub,
      };
    } catch (error: any) {
      await this.logFailedAttempt("apple", null, error.message);
      throw new Error(`Apple OAuth failed: ${error.message}`);
    }
  }

  /**
   * REQ-LI-B12: Create or retrieve user and issue session token
   */
  static async provisionUser(userInfo: OAuthUserInfo): Promise<{ token: string; user: any }> {
    let user = await prisma.user.findUnique({ where: { email: userInfo.email } });
    if (!user) {
      // REQ-SU-B04: OAuth-based account provisioning
      user = await prisma.user.create({
        data: {
          email: userInfo.email,
          name: userInfo.name,
          avatarUrl: userInfo.avatarUrl,
          status: "active",
          role: "MEMBER",
          // REQ-ACC-B08: default notification configuration
          emailPrefs: DEFAULT_NOTIFICATION_PREFS,
        },
      });
    } else if (user.status !== "active") {
      throw new Error("Account is not active");
    }

    // REQ-LI-B12: Issue signed session token
    const token = jwt.sign({ sub: user.id, provider: userInfo.provider }, env.JWT_SECRET, {
      expiresIn: "7d",
    });

    return { token, user };
  }

  /**
   * REQ-LI-B13: Log failed authentication attempts
   */
  static async logFailedAttempt(
    provider: string,
    email: string | null,
    reason: string
  ) {
    try {
      await prisma.auditLog.create({
        data: {
          action: `OAUTH_FAILED_${provider.toUpperCase()}`,
          metadata: { email, reason, timestamp: new Date().toISOString() },
        },
      });
    } catch (e) {
      console.error("Failed to log OAuth attempt", e);
    }
  }

  /**
   * Convert JWK to PEM format (for Microsoft token verification)
   */
  private static jwkToPem(jwk: any): string {
    // Simple RSA JWK to PEM conversion
    const n = Buffer.from(jwk.n, "base64");
    const e = Buffer.from(jwk.e, "base64");
    // DER encode the RSA public key
    const der = this.encodeRSAPublicKey(n, e);
    const b64 = der.toString("base64");
    const lines = b64.match(/.{1,64}/g)!.join("\n");
    return `-----BEGIN PUBLIC KEY-----\n${lines}\n-----END PUBLIC KEY-----`;
  }

  private static encodeRSAPublicKey(n: Buffer, e: Buffer): Buffer {
    const nEncoded = this.encodeUnsignedInteger(n);
    const eEncoded = this.encodeUnsignedInteger(e);
    const sequence = Buffer.concat([nEncoded, eEncoded]);
    const sequenceHeader = this.asn1Sequence(sequence.length);
    const bitString = Buffer.concat([Buffer.from([0x00]), sequenceHeader, sequence]);
    const bitStringHeader = this.asn1BitString(bitString.length);
    const algorithmIdentifier = Buffer.from([
      0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00,
    ]);
    const outer = Buffer.concat([algorithmIdentifier, bitStringHeader, bitString]);
    return Buffer.concat([this.asn1Sequence(outer.length), outer]);
  }

  private static encodeUnsignedInteger(buf: Buffer): Buffer {
    // Pad with 0x00 if high bit set
    const needsPadding = buf[0] & 0x80;
    const data = needsPadding ? Buffer.concat([Buffer.from([0x00]), buf]) : buf;
    return Buffer.concat([Buffer.from([0x02]), this.asn1Length(data.length), data]);
  }

  private static asn1Length(len: number): Buffer {
    if (len < 128) return Buffer.from([len]);
    if (len < 256) return Buffer.from([0x81, len]);
    return Buffer.from([0x82, (len >> 8) & 0xff, len & 0xff]);
  }

  private static asn1Sequence(len: number): Buffer {
    return Buffer.concat([Buffer.from([0x30]), this.asn1Length(len)]);
  }

  private static asn1BitString(len: number): Buffer {
    return Buffer.concat([Buffer.from([0x03]), this.asn1Length(len + 1)]);
  }
}
