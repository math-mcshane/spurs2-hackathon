import { webhookConfigResponse, scoreplayWebhookPost } from "@/lib/server/scoreplay-webhook";

/**
 * ScorePlay Connect → media.update
 *
 * Configure in ScorePlay:
 *   https://spurs2-hackathon.vercel.app/api/webhooks/scoreplay/media-update
 *
 * Auth (optional until SCOREPLAY_WEBHOOK_SECRET is set): Bearer / Basic / X-ScorePlay-Webhook-Secret
 */
export const GET = async () => webhookConfigResponse("media-update");
export const POST = scoreplayWebhookPost("media-update");
