import { App, LogLevel } from '@slack/bolt';
import { google, calendar_v3 } from 'googleapis';
import dotenv from 'dotenv';

import { createGoogleMeetEvent, createGroups, getChannelMembers } from './utils';
import { GROUP_SIZE, MEET_DURATION, MINUTES_UNTIL_START } from './constants';

dotenv.config();

const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
const SLACK_SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET;
const SLACK_APP_TOKEN = process.env.SLACK_APP_TOKEN; // @note: required for Socket Mode
const SLACK_CHANNEL_ID = process.env.SLACK_CHANNEL_ID; // @note: ID of #swift-coffees
const GOOGLE_SERVICE_ACCOUNT_KEY_PATH = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH; // @note: path to your Google service account JSON key file


if (!SLACK_BOT_TOKEN || !SLACK_SIGNING_SECRET || !SLACK_APP_TOKEN || !SLACK_CHANNEL_ID) {
    console.error("Missing Slack environment variables. Please check your .env file.");
    process.exit(1);
}

const app = new App({
    token: SLACK_BOT_TOKEN,
    signingSecret: SLACK_SIGNING_SECRET,
    socketMode: true,
    appToken: SLACK_APP_TOKEN,
    logLevel: LogLevel.INFO,
});

let calendarApi: calendar_v3.Calendar | null = null;

if (GOOGLE_SERVICE_ACCOUNT_KEY_PATH) {
    try {
        const auth = new google.auth.GoogleAuth({
            keyFile: GOOGLE_SERVICE_ACCOUNT_KEY_PATH,
            scopes: ['https://www.googleapis.com/auth/calendar.events'],
        });
        calendarApi = google.calendar({ version: 'v3', auth });
        console.log("Google Calendar API initialized successfully.");
    } catch (error) {
        console.error("Failed to initialize Google Calendar API:", error);
        calendarApi = null; // Ensure it's null if setup fails
    }
} else {
    console.warn("GOOGLE_SERVICE_ACCOUNT_KEY_PATH not set. Google Meet creation will be disabled.");
}


// --- Slack Command Handler ---
// Listens for a slash command (e.g., /swift-coffees-generate)
app.command('/swift-coffees-generate', async ({ command, ack, client, say, respond }) => {
    await ack(); // Acknowledge command receipt within 3 seconds

    if (!SLACK_CHANNEL_ID) {
        await respond("Error: SLACK_CHANNEL_ID is not configured. Please tell the bot admin.");
        return;
    }
    
    try {
        await say(`Got it! Fetching members from <#${SLACK_CHANNEL_ID}> and brewing some coffee chats... ☕`);

        const users = await getChannelMembers(client, SLACK_CHANNEL_ID);

        if (users.length < 2) {
            await respond("Not enough users in the channel to form coffee groups (minimum 2 required).");
            return;
        }

        const groups = createGroups(users, GROUP_SIZE);

        if (groups.length === 0) {
            await respond("Could not form any coffee groups.");
            return;
        }

        let resultsMessage = "✨ Swift Coffee Chats for this week are ready! ✨\n\n";
        let allEventsScheduled = true;

        const now = new Date();
        const meetingStartTime = new Date(now.getTime() + MINUTES_UNTIL_START * 60000); // Start in 5 minutes
        // @to-do review if we want the meeting to always be at the same time on Wednesdays for example

        for (let i = 0; i < groups.length; i++) {
            const group = groups[i];
            const groupMemberTags = group.members.map(member => `<@${member.id}>`).join(', ');
            resultsMessage += `*Group ${i + 1}:* ${groupMemberTags}\n`;

            if (calendarApi && GOOGLE_SERVICE_ACCOUNT_KEY_PATH) {
                 if (group.members.filter(m => m.email).length < 1 && group.members.length >=1 ) { // if there are members but none have email
                    resultsMessage += `  🔴 Could not create Google Meet: No members in this group have email addresses configured in their Slack profiles.\n`;
                    allEventsScheduled = false;
                } else if (group.members.length === 0) {
                     resultsMessage += `  🟡 This group is empty (this shouldn't happen, please check bot logs).\n`;
                }
                else {
                    const eventDetails = await createGoogleMeetEvent(group, meetingStartTime, MEET_DURATION, calendarApi);
                    if (eventDetails.meetLink) {
                        group.meetLink = eventDetails.meetLink;
                        group.eventId = eventDetails.eventId;
                        resultsMessage += `  🔗 Google Meet: ${group.meetLink}\n`;
                    } else {
                        resultsMessage += `  🔴 Error creating Google Meet: ${eventDetails.error || 'Unknown error'}\n`;
                        allEventsScheduled = false;
                    }
                }
            } else {
                resultsMessage += `  🟡 Google Meet creation skipped (Google Calendar API not configured).\n`;
                allEventsScheduled = false; // Or handle as a different status
            }
            resultsMessage += "\n";
        }
        
        if (allEventsScheduled && calendarApi) {
             resultsMessage += "\nAll Google Meet events have been scheduled successfully!";
        } else if (calendarApi) {
            resultsMessage += "\nSome Google Meet events could not be scheduled. Please check details above.";
        } else {
            resultsMessage += "\nGoogle Meet creation was skipped as the Calendar API is not configured.";
        }

        // Post results to the channel where command was invoked, or to a specific channel
        await say({
            channel: command.channel_id, // Post in the channel where command was used
            text: resultsMessage,
        });

    } catch (error) {
        console.error("Error in /swift-coffees-generate command:", error);
        await respond(`An error occurred: ${(error as Error).message}. Please check the bot logs.`);
    }
});


// --- Start the Bot ---
(async () => {
    try {
        await app.start();
        console.log('⚡️ Bolt app is running in Socket Mode!');
        if (!calendarApi && GOOGLE_SERVICE_ACCOUNT_KEY_PATH) {
             console.warn("Google Calendar API failed to initialize during startup. Meet creation will be affected.");
        }
    } catch (error) {
        console.error('Unable to start Bolt app', error);
        process.exit(1);
    }
})();

// Basic error handler
app.error(async (error) => {
    console.error("Global error handler caught:", error);
});
