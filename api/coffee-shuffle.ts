import type { VercelRequest, VercelResponse } from '@vercel/node';
import { WebClient } from '@slack/web-api';
import { google, calendar_v3 } from 'googleapis';
import { createGoogleMeetEvent, createGroups, getChannelMembers } from '../src/utils';
import { GROUP_SIZE, MEET_DURATION, MINUTES_UNTIL_START } from '../src/constants';

const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
const SLACK_CHANNEL_ID = process.env.SLACK_CHANNEL_ID;
const GOOGLE_SERVICE_ACCOUNT_JSON = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
const GOOGLE_DELEGATED_USER = process.env.GOOGLE_DELEGATED_USER || 'tools@tailor-hub.com';
const CRON_SECRET = process.env.CRON_SECRET;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Verify cron secret for security
  if (req.headers.authorization !== `Bearer ${CRON_SECRET}`) {
    console.log('Authorization failed:', {
      received: req.headers.authorization,
      expected: `Bearer ${CRON_SECRET}`,
      cronSecretExists: !!CRON_SECRET
    });
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // Only allow GET requests
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Validate required environment variables
    if (!SLACK_BOT_TOKEN || !SLACK_CHANNEL_ID) {
      console.error('Missing required Slack environment variables');
      return res.status(400).json({ 
        error: 'Missing required Slack configuration',
        details: 'SLACK_BOT_TOKEN and SLACK_CHANNEL_ID must be set'
      });
    }

    console.log('🎲 Starting weekly coffee shuffle...');

    // Initialize Slack client
    const slackClient = new WebClient(SLACK_BOT_TOKEN);

    // Initialize Google Calendar API if configured
    let calendarApi: calendar_v3.Calendar | null = null;
    if (GOOGLE_SERVICE_ACCOUNT_JSON) {
      try {
        console.log('Initializing Google Calendar API...');
        const credentials = JSON.parse(GOOGLE_SERVICE_ACCOUNT_JSON);
        const auth = new google.auth.GoogleAuth({
          credentials: credentials,
          scopes: [
            'https://www.googleapis.com/auth/calendar',
            'https://www.googleapis.com/auth/calendar.events'
          ],
        });
        
        const authClient = await auth.getClient();
        (authClient as any).subject = GOOGLE_DELEGATED_USER;
        calendarApi = google.calendar({ version: 'v3', auth: authClient as any });
        console.log('✅ Google Calendar API initialized successfully');
      } catch (error) {
        console.error('❌ Failed to initialize Google Calendar API:', error);
        calendarApi = null;
      }
    } else {
      console.warn('⚠️ Google Calendar API not configured - Meet creation will be skipped');
    }

    // Get channel members and create groups
    const users = await getChannelMembers(slackClient, SLACK_CHANNEL_ID);

    if (users.length < 2) {
      const message = 'Not enough users in the channel to form coffee groups (minimum 2 required).';
      console.warn('⚠️', message);
      await postToChannel(slackClient, SLACK_CHANNEL_ID, message);
      return res.status(200).json({ 
        success: false, 
        message,
        userCount: users.length
      });
    }

    const groups = createGroups(users, GROUP_SIZE);

    if (groups.length === 0) {
      const message = 'Could not form any coffee groups.';
      console.warn('⚠️', message);
      await postToChannel(slackClient, SLACK_CHANNEL_ID, message);
      return res.status(200).json({ 
        success: false, 
        message 
      });
    }

    console.log(`✨ Created ${groups.length} coffee groups`);

    // Build results message
    let resultsMessage = "☕ **Weekly Swift Coffee Chats** ☕\n";
    resultsMessage += "_Automatically scheduled for this Wednesday!_\n\n";
    
    let allEventsScheduled = true;
    let hasErrors = false;

    // Schedule meeting for current time + configured minutes
    const now = new Date();
    const meetingStartTime = new Date(now.getTime() + MINUTES_UNTIL_START * 60000);

    // Process each group
    for (let i = 0; i < groups.length; i++) {
      const group = groups[i];
      const groupMemberTags = group.members.map(member => `<@${member.id}>`).join(', ');
      resultsMessage += `*Group ${i + 1}:* ${groupMemberTags}\n`;

      if (calendarApi) {
        if (group.members.filter(m => m.email).length < 1 && group.members.length >= 1) {
          resultsMessage += `  🔴 Could not create Google Meet: No members in this group have email addresses.\n`;
          allEventsScheduled = false;
          hasErrors = true;
        } else if (group.members.length === 0) {
          resultsMessage += `  🟡 This group is empty (unexpected error).\n`;
          hasErrors = true;
        } else {
          const eventDetails = await createGoogleMeetEvent(group, meetingStartTime, MEET_DURATION, calendarApi);
          if (eventDetails.meetLink) {
            group.meetLink = eventDetails.meetLink;
            group.eventId = eventDetails.eventId;
            resultsMessage += `  🔗 Google Meet: ${group.meetLink}\n`;
            resultsMessage += `  📅 Time: ${meetingStartTime.toLocaleTimeString('en-US', { 
              hour: '2-digit', 
              minute: '2-digit',
              timeZoneName: 'short'
            })} (${MEET_DURATION} minutes)\n`;
          } else {
            resultsMessage += `  🔴 Error creating Google Meet: ${eventDetails.error || 'Unknown error'}\n`;
            allEventsScheduled = false;
            hasErrors = true;
          }
        }
      } else {
        resultsMessage += `  🟡 Google Meet creation skipped (Calendar API not configured).\n`;
        allEventsScheduled = false;
      }
      resultsMessage += "\n";
    }

    // Add status summary
    if (allEventsScheduled && calendarApi) {
      resultsMessage += "\n✅ All Google Meet events have been scheduled successfully!";
    } else if (calendarApi) {
      resultsMessage += "\n⚠️ Some Google Meet events could not be scheduled. Please check details above.";
    } else {
      resultsMessage += "\n📝 Google Meet creation was skipped as the Calendar API is not configured.";
    }

    resultsMessage += "\n\n_Next coffee shuffle: Next Wednesday at 12:00 PM_ 🗓️";

    // Post to Slack channel
    await postToChannel(slackClient, SLACK_CHANNEL_ID, resultsMessage);

    console.log('✅ Coffee shuffle completed successfully');

    return res.status(200).json({
      success: true,
      message: 'Coffee shuffle completed successfully',
      groupsCreated: groups.length,
      usersProcessed: users.length,
      eventsScheduled: allEventsScheduled,
      hasErrors
    });

  } catch (error) {
    console.error('❌ Error in coffee shuffle:', error);
    
    // Try to notify in Slack about the error
    if (SLACK_BOT_TOKEN && SLACK_CHANNEL_ID) {
      try {
        const slackClient = new WebClient(SLACK_BOT_TOKEN);
        await postToChannel(
          slackClient, 
          SLACK_CHANNEL_ID, 
          `❌ An error occurred during the weekly coffee shuffle: ${(error as Error).message}`
        );
      } catch (slackError) {
        console.error('❌ Failed to send error message to Slack:', slackError);
      }
    }

    return res.status(500).json({
      success: false,
      error: 'Coffee shuffle failed',
      details: (error as Error).message
    });
  }
}

/**
 * Helper function to post messages to Slack channel
 */
async function postToChannel(client: WebClient, channelId: string, message: string): Promise<void> {
  try {
    await client.chat.postMessage({
      channel: channelId,
      text: message,
    });
    console.log('✅ Message posted to Slack channel');
  } catch (error) {
    console.error('❌ Failed to post message to channel:', error);
    throw error;
  }
}
