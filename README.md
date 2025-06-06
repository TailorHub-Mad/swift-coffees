# Swifty - Slack Coffee Chat Bot

A TypeScript-based Slack bot that automatically organizes coffee chat groups and schedules Google Meet sessions for your team.

## Features

- **Automatic Weekly Scheduling**: Triggers coffee shuffles every Wednesday at 11:45 AM
- **Manual Coffee Generation**: Create coffee groups on-demand
- **Google Meet Integration**: Automatically creates Google Meet links for each group
- **Flexible Group Sizes**: Configurable group sizes (default: 3 people)
- **Smart Email Handling**: Only creates calendar events for users with email addresses

## Automatic Scheduling

The bot is configured to automatically trigger coffee shuffles:
- **Day**: Every Wednesday
- **Time**: 11:45 AM (Madrid/Europe timezone)
- **Duration**: 15 minutes per coffee chat
- **Frequency**: Weekly

## Available Commands

### Core Commands
- `/swift-coffees-generate` - Manually create coffee groups with Google Meet links
- `/swift-coffees-trigger-now` - Trigger the automated coffee shuffle immediately

## Setup

### Prerequisites
- Node.js and npm
- Slack app with Bot Token and Socket Mode
- Google Service Account with Calendar API access (optional)

### Environment Variables
Create a `.env` file with:

```
SLACK_BOT_TOKEN=xoxb-your-bot-token
SLACK_SIGNING_SECRET=your-signing-secret
SLACK_APP_TOKEN=xapp-your-app-token
SLACK_CHANNEL_ID=your-channel-id
GOOGLE_SERVICE_ACCOUNT_JSON=your-json-minified
GOOGLE_DELEGATED_USER=user@yourdomain.com
```

### Installation
```bash
npm install
npm run build
npm start
```

## Configuration

### Meeting Duration
The meeting duration is set to 15 minutes and can be modified in `src/constants.ts`:

```typescript
export const MEET_DURATION = 15; // minutes
```

### Group Size
Default group size is 3 people, configurable in `src/constants.ts`:

```typescript
export const GROUP_SIZE = 3;
```

### Schedule Timing
The automatic schedule is set for Wednesdays at 11:45 AM. To modify this, update the cron pattern in `src/scheduler.ts`:

```typescript
// Current: '45 11 * * 3' (45 minutes, 11 hour, any day, any month, Wednesday)
this.scheduledTask = cron.schedule('45 11 * * 3', async () => {
  // Your custom timing here
});
```

### Timezone
The scheduler uses `Europe/Madrid` timezone (Spain). Modify in `src/scheduler.ts`:

```typescript
timezone: 'Europe/Madrid' // Spain timezone
```

## How It Works

1. **Automatic Trigger**: Every Wednesday at 11:45 AM (Madrid time), the bot automatically:
   - Fetches all members from the configured Slack channel
   - Creates randomized coffee groups
   - Schedules 15-minute Google Meet sessions
   - Posts group assignments to the Slack channel

2. **Manual Trigger**: Users can manually generate coffee groups using `/swift-coffees-generate` or trigger the automated shuffle using `/swift-coffees-trigger-now`

3. **Google Meet Integration**: If configured, creates calendar events with Google Meet links for each group

4. **Code-Controlled Scheduling**: The weekly scheduler starts automatically when the bot launches and runs continuously - no Slack commands needed to manage it

## Development

### Project Structure
```
src/
├── app.ts          # Main Slack bot application
├── scheduler.ts    # Weekly scheduling logic
├── utils.ts        # Group creation and Google Meet utilities
├── constants.ts    # Configuration constants
└── types.ts        # TypeScript type definitions
```

### Building and Running
```bash
# Development
npm start

# Production build
npm run build
node dist/app.js
```

## Troubleshooting

- **Scheduler not working**: Check that `SLACK_CHANNEL_ID` is set correctly
- **Google Meet creation fails**: Verify Google Service Account setup and permissions
- **Bot not responding**: Ensure Slack tokens are valid and Socket Mode is enabled

## License

ISC 

## Deployment to Fly.io

### Prerequisites

1. **Install Fly.io CLI:**
   ```bash
   curl -L https://fly.io/install.sh | sh
   ```

2. **Sign up and login to Fly.io:**
   ```bash
   flyctl auth signup  # or flyctl auth login if you have an account
   ```

### Deploy Steps

1. **Launch your app (first time only):**
   ```bash
   flyctl launch
   ```
   - Choose a unique app name (or accept the generated one)
   - Select a region close to you
   - Don't deploy immediately when prompted

2. **Set your environment variables:**
   ```bash
   flyctl secrets set SLACK_BOT_TOKEN="your_slack_bot_token"
   flyctl secrets set SLACK_SIGNING_SECRET="your_slack_signing_secret"
   flyctl secrets set SLACK_APP_TOKEN="your_slack_app_token"
   flyctl secrets set SLACK_CHANNEL_ID="your_slack_channel_id"
   flyctl secrets set GOOGLE_SERVICE_ACCOUNT_JSON='{"type":"service_account",...}'
   flyctl secrets set GOOGLE_DELEGATED_USER="your-email@domain.com"
   ```

3. **Deploy:**
   ```bash
   ./deploy.sh
   ```
   Or manually:
   ```bash
   flyctl deploy
   ```

### Monitoring

- **Check app status:** `flyctl status`
- **View logs:** `flyctl logs`
- **Health check:** Your app will be available at `https://your-app-name.fly.dev/health`

### Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `SLACK_BOT_TOKEN` | Your Slack bot token | ✅ |
| `SLACK_SIGNING_SECRET` | Your Slack app signing secret | ✅ |
| `SLACK_APP_TOKEN` | Your Slack app token (for Socket Mode) | ✅ |
| `SLACK_CHANNEL_ID` | The Slack channel ID for coffee chats | ✅ |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Google service account credentials (JSON) | ⚠️ Optional* |
| `GOOGLE_DELEGATED_USER` | Email to impersonate for calendar access | ⚠️ Optional* |

*Google credentials are optional but required for Google Meet creation.

### Cost

Fly.io offers a generous free tier that should cover this background worker application. The app uses minimal resources as it only:
- Maintains a Socket Mode connection to Slack
- Runs weekly scheduled tasks
- Serves health check requests

### Troubleshooting

1. **Check logs if the app isn't working:**
   ```bash
   flyctl logs --tail
   ```

2. **Restart the app:**
   ```bash
   flyctl apps restart your-app-name
   ```

3. **Scale down/up if needed:**
   ```bash
   flyctl scale count 1
   ``` 