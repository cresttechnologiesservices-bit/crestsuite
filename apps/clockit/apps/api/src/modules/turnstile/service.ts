import { prisma } from "../../lib/prisma";
import env from "../../config";

export class TurnstileService {
  /**
   * REQ-LI-B01: Verify Cloudflare Turnstile token server-side
   */
  static async verify(token: string, ip: string, email?: string): Promise<boolean> {
    // Rate limit - block after 5 failures per IP in the last 10 minutes
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
    const recentFailures = await prisma.turnstileAttempt.count({
      where: { ip, success: false, createdAt: { gte: tenMinutesAgo } },
    });
    if (recentFailures >= 5) {
      throw new Error("Too many verification attempts. Please try again later.");
    }
    try {
      // In test/dev mode, accept "test-token"
      if (env.TURNSTILE_SECRET === "test" && token === "test-token") {
        await this.logAttempt(ip, email, true);
        return true;
      }
      const formData = new URLSearchParams();
      formData.append("secret", env.TURNSTILE_SECRET);
      formData.append("response", token);
      formData.append("remoteip", ip);
      const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
        method: "POST",
        body: formData,
      });
      const result = (await response.json()) as any;
      const success = result.success === true;
      await this.logAttempt(ip, email, success);
      return success;
    } catch (error: any) {
      console.error("Turnstile verification failed:", error);
      await this.logAttempt(ip, email, false);
      return false;
    }
  }

  private static async logAttempt(ip: string, email: string | undefined, success: boolean) {
    try {
      await prisma.turnstileAttempt.create({
        data: { ip, email, success },
      });
    } catch (e) {
      console.error("Failed to log turnstile attempt", e);
    }
  }
}
