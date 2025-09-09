import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Only allow GET requests
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const health = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    environment: {
      slackConfigured: !!process.env.SLACK_BOT_TOKEN && !!process.env.SLACK_CHANNEL_ID,
      googleCalendarConfigured: !!process.env.GOOGLE_SERVICE_ACCOUNT_JSON,
      cronSecretConfigured: !!process.env.CRON_SECRET,
    },
    deployment: {
      platform: 'vercel',
      runtime: 'serverless',
    }
  };

  return res.status(200).json(health);
}
