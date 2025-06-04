import { App, LogLevel } from '@slack/bolt';
import { google, calendar_v3 } from 'googleapis';
import dotenv from 'dotenv';
import http from 'http';

import { createGoogleMeetEvent, createGroups, getChannelMembers } from './utils';
import { GROUP_SIZE, MEET_DURATION, MINUTES_UNTIL_START } from './constants';
import { CoffeeScheduler } from './scheduler';

dotenv.config();

const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
const SLACK_SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET;
const SLACK_APP_TOKEN = process.env.SLACK_APP_TOKEN;
const SLACK_CHANNEL_ID = process.env.SLACK_CHANNEL_ID;
const GOOGLE_SERVICE_ACCOUNT_JSON = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
const GOOGLE_DELEGATED_USER = process.env.GOOGLE_DELEGATED_USER || 'tools@tailor-hub.com'; // Service account will impersonate this user


if (!SLACK_BOT_TOKEN || !SLACK_SIGNING_SECRET || !SLACK_APP_TOKEN || !SLACK_CHANNEL_ID) {
    console.error("Missing Slack environment variables. Please check your .env file.");
    process.exit(1);
}

if (!GOOGLE_SERVICE_ACCOUNT_JSON) {
    console.error("Missing GOOGLE_SERVICE_ACCOUNT_JSON. Please check your .env file.");
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
let coffeeScheduler: CoffeeScheduler | null = null;

app.command('/swift-coffees-generate', async ({ command, ack, client, say, respond }) => {
    await ack();

    if (!SLACK_CHANNEL_ID) {
        await respond("Error: SLACK_CHANNEL_ID is not configured. Please tell the bot admin.");
        return;
    }
    
    if (GOOGLE_SERVICE_ACCOUNT_JSON && !calendarApi) {
        await respond("Google Calendar API is not initialized yet or failed to initialize. Please try again in a few moments or check the logs.");
        return;
    }
    
    try {
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

        console.log('results', { users, groups })

        let resultsMessage = "✨ **Manual Swift Coffee Chats** ✨\n";
        resultsMessage += "_Generated on demand!_\n\n";
        let allEventsScheduled = true;
        let hasErrors = false;

        const now = new Date();
        const meetingStartTime = new Date(now.getTime() + MINUTES_UNTIL_START * 60000); // Start in 15 minutes

        for (let i = 0; i < groups.length; i++) {
            const group = groups[i];
            const groupMemberTags = group.members.map(member => `<@${member.id}>`).join(', ');
            resultsMessage += `*Group ${i + 1}:* ${groupMemberTags}\n`;

            if (calendarApi && GOOGLE_SERVICE_ACCOUNT_JSON) {
                 if (group.members.filter(m => m.email).length < 1 && group.members.length >=1 ) { // if there are members but none have email
                    resultsMessage += `  🔴 Could not create Google Meet: No members in this group have email addresses configured in their Slack profiles.\n`;
                    allEventsScheduled = false;
                    hasErrors = true;
                } else if (group.members.length === 0) {
                     resultsMessage += `  🟡 This group is empty (this shouldn't happen, please check bot logs).\n`;
                     hasErrors = true;
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
                        hasErrors = true;
                    }
                }
            } else {
                resultsMessage += `  🟡 Google Meet creation skipped (Google Calendar API not configured).\n`;
                allEventsScheduled = false;
            }
            resultsMessage += "\n";
        }
        
        if (allEventsScheduled && calendarApi) {
             resultsMessage += "\n✅ All Google Meet events have been scheduled successfully!";
        } else if (calendarApi) {
            resultsMessage += "\n⚠️ Some Google Meet events could not be scheduled. Please check details above.";
        } else {
            resultsMessage += "\n📝 Google Meet creation was skipped as the Calendar API is not configured.";
        }

        if (!hasErrors) {
            await say({
                channel: command.channel_id,
                text: resultsMessage,
            });
        } else {
            await respond(resultsMessage);
        }

    } catch (error) {
        console.error("Error in /swift-coffees-generate command:", error);
        await respond(`An error occurred: ${(error as Error).message}. Please check the bot logs.`);
    }
});

app.command('/swift-coffees-trigger-now', async ({ command, ack, respond }) => {
    await ack();

    if (!SLACK_CHANNEL_ID) {
        await respond("Error: SLACK_CHANNEL_ID is not configured. Please tell the bot admin.");
        return;
    }

    try {
        if (!coffeeScheduler) {
            coffeeScheduler = new CoffeeScheduler({
                slackApp: app,
                calendarApi: calendarApi,
                channelId: SLACK_CHANNEL_ID
            });
        }

        await respond("🎲 Triggering coffee shuffle now...");
        await coffeeScheduler.triggerCoffeeShuffle();
    } catch (error) {
        console.error("Error triggering coffee shuffle:", error);
        await respond(`Failed to trigger coffee shuffle: ${(error as Error).message}`);
    }
});

// Simple HTTP server for health checks (required by Fly.io)
const healthServer = http.createServer((req, res) => {
    if (req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
            status: 'healthy', 
            timestamp: new Date().toISOString(),
            services: {
                slack: app ? 'connected' : 'disconnected',
                calendar: calendarApi ? 'initialized' : 'not_initialized',
                scheduler: coffeeScheduler ? 'running' : 'not_running'
            }
        }));
    } else {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
    }
});

(async () => {
    try {
        if (GOOGLE_SERVICE_ACCOUNT_JSON) {
            try {
                console.log("Initializing Google Calendar API with delegated user...");
                
                let auth: any;
                
                if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
                    const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
                    auth = new google.auth.GoogleAuth({
                        credentials: credentials,
                        scopes: [
                            'https://www.googleapis.com/auth/calendar',
                            'https://www.googleapis.com/auth/calendar.events'
                        ],
                    });
                    console.log("Using Google credentials from environment variable");
                } else {
                    console.log('No GOOGLE_SERVICE_ACCOUNT_JSON found, using GOOGLE_SERVICE_ACCOUNT_KEY_PATH');
                }
                
                const authClient = await auth.getClient();
                (authClient as any).subject = GOOGLE_DELEGATED_USER;
                
                calendarApi = google.calendar({ version: 'v3', auth: authClient as any });
                console.log(`Google Calendar API initialized successfully with delegated user: ${GOOGLE_DELEGATED_USER}`);
            } catch (error) {
                console.error("Failed to initialize Google Calendar API:", error);
                calendarApi = null;
            }
        } else {
            console.warn("Neither GOOGLE_SERVICE_ACCOUNT_KEY_PATH nor GOOGLE_SERVICE_ACCOUNT_JSON set. Google Meet creation will be disabled.");
            return;
        }
        
        await app.start();
        console.log('⚡️ Swifty app is running in Socket Mode!');
        
        // Start health check server for Fly.io
        const PORT = process.env.PORT || 8080;
        healthServer.listen(PORT, () => {
            console.log(`🏥 Health check server running on port ${PORT}`);
        });
        
        if (SLACK_CHANNEL_ID) {
            try {
                console.log('🗓️ Initializing Coffee Scheduler...');
                coffeeScheduler = new CoffeeScheduler({
                    slackApp: app,
                    calendarApi: calendarApi,
                    channelId: SLACK_CHANNEL_ID
                });
                
                // Automatically start the weekly schedule
                coffeeScheduler.startWeeklySchedule();
                console.log('✅ Coffee Scheduler initialized and weekly schedule started!');
                
                // Update scheduler with calendar API if it was initialized
                if (calendarApi) {
                    coffeeScheduler.updateCalendarApi(calendarApi);
                }
            } catch (error) {
                console.error('❌ Failed to initialize Coffee Scheduler:', error);
            }
        } else {
            console.warn('⚠️ SLACK_CHANNEL_ID not set. Coffee Scheduler will not be initialized.');
        }
        
        if (!calendarApi && GOOGLE_SERVICE_ACCOUNT_JSON) {
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
