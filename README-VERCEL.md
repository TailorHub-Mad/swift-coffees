# Swift Coffees - Vercel Serverless

A minimal serverless application that automatically creates weekly coffee chat groups in Slack with Google Meet integration. Runs on Vercel with cron scheduling.

## 🚀 Quick Deployment

### 1. Deploy to Vercel

```bash
# Install Vercel CLI if you haven't already
npm install -g vercel

# Deploy the application
vercel --prod
```

### 2. Configure Environment Variables

In your Vercel dashboard, add the following environment variables:

#### Required Variables:
- `SLACK_BOT_TOKEN`: Your Slack bot token (starts with `xoxb-`)
- `SLACK_CHANNEL_ID`: The Slack channel ID where coffee chats will be posted
- `CRON_SECRET`: A random secret string for cron job security

#### Optional Variables (for Google Meet integration):
- `GOOGLE_SERVICE_ACCOUNT_JSON`: Your Google service account credentials as JSON string
- `GOOGLE_DELEGATED_USER`: Email address to impersonate (default: `tools@tailor-hub.com`)
- `GOOGLE_CALENDAR_ID`: Calendar ID to create events in (default: `primary`)

### 3. Verify Deployment

After deployment, you can:
- Check health: `https://your-app.vercel.app/api/health`
- The cron job will automatically run every Wednesday at 12:00 PM UTC

## 📅 Scheduling

The application is configured to run automatically every Wednesday at 12:00 PM UTC via Vercel's cron jobs. This is defined in `vercel.json`:

```json
{
  "crons": [
    {
      "path": "/api/coffee-shuffle",
      "schedule": "0 12 * * 3"
    }
  ]
}
```

## 🔧 Manual Trigger

You can manually trigger the coffee shuffle by making a GET request to:
```
https://your-app.vercel.app/api/coffee-shuffle
```

**Note**: You need to include the authorization header:
```
Authorization: Bearer YOUR_CRON_SECRET
```

## 🏗️ Architecture Changes

### From Persistent Bot to Serverless Functions

The original application ran as a persistent Slack bot with socket mode. The Vercel version has been refactored to:

1. **Serverless Functions**: Each API endpoint runs independently
2. **No Socket Mode**: Uses REST API calls instead of persistent connections
3. **Cron Scheduling**: Vercel handles the weekly scheduling
4. **Stateless**: No persistent state between executions

### Key Files:

- `api/coffee-shuffle.ts`: Main serverless function (triggered by cron)
- `api/health.ts`: Health check endpoint
- `vercel.json`: Vercel configuration with cron job setup
- `src/utils.ts`: Core utility functions
- `src/constants.ts`: Configuration constants
- `src/types.ts`: TypeScript interfaces

## 🔍 Monitoring

Check the function logs in your Vercel dashboard to monitor execution and troubleshoot any issues.

## 🛠️ Development

For local development:

```bash
# Install dependencies
npm install

# Run locally with Vercel CLI
vercel dev
```

This will start a local server that mimics the Vercel environment.

## 📝 Notes

- The Google Calendar integration requires proper service account setup with domain-wide delegation
- Make sure your Slack bot has the necessary permissions (`chat:write`, `users:read`, `users:read.email`)
- The cron job uses UTC time - adjust the schedule in `vercel.json` if needed for different timezones
