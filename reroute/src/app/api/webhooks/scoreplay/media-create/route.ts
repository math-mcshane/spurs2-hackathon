import { webhookConfigResponse, scoreplayWebhookPost } from "@/lib/server/scoreplay-webhook";

/**
 * ScorePlay Connect → media.create
 *
 * Configure in ScorePlay:
 *   https://spurs2-hackathon.vercel.app/api/webhooks/scoreplay/media-create
 *
 * Auth (optional until SCOREPLAY_WEBHOOK_SECRET is set): Bearer / Basic / X-ScorePlay-Webhook-Secret
 */
export const GET = async () => webhookConfigResponse("media-create");
export const POST = scoreplayWebhookPost("media-create");
