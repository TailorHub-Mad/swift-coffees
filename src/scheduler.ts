import * as cron from 'node-cron';
import { App } from '@slack/bolt';
import { calendar_v3 } from 'googleapis';
import { createGoogleMeetEvent, createGroups, getChannelMembers } from './utils';
import { GROUP_SIZE } from './constants';

interface SchedulerConfig {
  slackApp: App;
  calendarApi: calendar_v3.Calendar | null;
  channelId: string;
}

export class CoffeeScheduler {
  private app: App;
  private calendarApi: calendar_v3.Calendar | null;
  private channelId: string;
  private scheduledTask: cron.ScheduledTask | null = null;

  constructor(config: SchedulerConfig) {
    this.app = config.slackApp;
    this.calendarApi = config.calendarApi;
    this.channelId = config.channelId;
  }

  /**
   * Start the weekly scheduler for Wednesdays at 11:45 AM
   * Cron pattern: '45 11 * * 3' (minute hour day month day-of-week)
   * Day-of-week: 0 = Sunday, 3 = Wednesday
   */
  public startWeeklySchedule(): void {
    // Stop any existing scheduled task
    this.stopSchedule();

    console.log('🗓️ Setting up weekly coffee shuffle for Wednesdays at 11:45 AM...');
    
    // Schedule for every Wednesday at 11:45 AM
    this.scheduledTask = cron.schedule('45 11 * * 3', async () => {
      console.log('⏰ Triggering weekly coffee shuffle...');
      await this.triggerCoffeeShuffle();
    }, {
      timezone: 'Europe/Madrid' // Spain timezone
    });

    console.log('✅ Weekly coffee shuffle scheduled successfully!');
    console.log('📅 Next trigger: Every Wednesday at 11:45 AM');
  }

  /**
   * Stop the scheduled task
   */
  public stopSchedule(): void {
    if (this.scheduledTask) {
      this.scheduledTask.stop();
      this.scheduledTask = null;
      console.log('🛑 Coffee shuffle schedule stopped.');
    }
  }

  /**
   * Manually trigger the coffee shuffle (same logic as the slash command)
   */
  public async triggerCoffeeShuffle(): Promise<void> {
    try {
      if (!this.channelId) {
        console.error('❌ SLACK_CHANNEL_ID is not configured');
        return;
      }

      // Check if calendarApi is available
      if (!this.calendarApi) {
        console.warn('⚠️ Google Calendar API is not initialized. Meet creation will be skipped.');
      }

      console.log('🎲 Getting channel members and creating groups...');
      const users = await getChannelMembers(this.app.client, this.channelId);

      if (users.length < 2) {
        console.warn('⚠️ Not enough users in the channel to form coffee groups (minimum 2 required)');
        await this.postToChannel("Not enough users in the channel to form coffee groups (minimum 2 required).");
        return;
      }

      const groups = createGroups(users, GROUP_SIZE);

      if (groups.length === 0) {
        console.warn('⚠️ Could not form any coffee groups');
        await this.postToChannel("Could not form any coffee groups.");
        return;
      }

      console.log(`✨ Created ${groups.length} coffee groups`);

      let resultsMessage = "☕ **Weekly Swift Coffee Chats** ☕\n";
      resultsMessage += "_Automatically scheduled for this Wednesday!_\n\n";
      
      let allEventsScheduled = true;
      let hasErrors = false;

      // Schedule meeting for today at current time + 15 minutes (to allow people to see the notification)
      const now = new Date();
      const meetingStartTime = new Date(now.getTime() + 15 * 60000); // 15 minutes from now
      const meetDuration = 15; // 15 minutes duration as requested

      for (let i = 0; i < groups.length; i++) {
        const group = groups[i];
        const groupMemberTags = group.members.map(member => `<@${member.id}>`).join(', ');
        resultsMessage += `*Group ${i + 1}:* ${groupMemberTags}\n`;

        if (this.calendarApi) {
          if (group.members.filter(m => m.email).length < 1 && group.members.length >= 1) {
            resultsMessage += `  🔴 Could not create Google Meet: No members in this group have email addresses.\n`;
            allEventsScheduled = false;
            hasErrors = true;
          } else if (group.members.length === 0) {
            resultsMessage += `  🟡 This group is empty (unexpected error).\n`;
            hasErrors = true;
          } else {
            const eventDetails = await createGoogleMeetEvent(group, meetingStartTime, meetDuration, this.calendarApi);
            if (eventDetails.meetLink) {
              group.meetLink = eventDetails.meetLink;
              group.eventId = eventDetails.eventId;
              resultsMessage += `  🔗 Google Meet: ${group.meetLink}\n`;
              resultsMessage += `  📅 Time: ${meetingStartTime.toLocaleTimeString('en-US', { 
                hour: '2-digit', 
                minute: '2-digit',
                timeZoneName: 'short'
              })} (${meetDuration} minutes)\n`;
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

      if (allEventsScheduled && this.calendarApi) {
        resultsMessage += "\n✅ All Google Meet events have been scheduled successfully!";
      } else if (this.calendarApi) {
        resultsMessage += "\n⚠️ Some Google Meet events could not be scheduled. Please check details above.";
      } else {
        resultsMessage += "\n📝 Google Meet creation was skipped as the Calendar API is not configured.";
      }

      resultsMessage += "\n\n_Next coffee shuffle: Next Wednesday at 11:45 AM_ 🗓️";

      // Only post to channel if there were no critical errors
      if (!hasErrors) {
        await this.postToChannel(resultsMessage);
        console.log('✅ Coffee shuffle completed successfully and posted to channel');
      } else {
        console.error('❌ Coffee shuffle completed with errors');
        await this.postToChannel(resultsMessage);
      }

    } catch (error) {
      console.error('❌ Error in coffee shuffle:', error);
      await this.postToChannel(`An error occurred during the coffee shuffle: ${(error as Error).message}`);
    }
  }

  /**
   * Post a message to the configured Slack channel
   */
  private async postToChannel(message: string): Promise<void> {
    try {
      await this.app.client.chat.postMessage({
        channel: this.channelId,
        text: message,
      });
    } catch (error) {
      console.error('❌ Failed to post message to channel:', error);
    }
  }

  /**
   * Get information about the current schedule
   */
  public getScheduleInfo(): string {
    if (this.scheduledTask) {
      return '📅 Coffee shuffle is scheduled for every Wednesday at 11:45 AM (15-minute duration)';
    }
    return '❌ Coffee shuffle is not currently scheduled';
  }

  /**
   * Update the calendar API reference (useful if it gets reinitialized)
   */
  public updateCalendarApi(calendarApi: calendar_v3.Calendar | null): void {
    this.calendarApi = calendarApi;
    console.log('🔄 Calendar API reference updated in scheduler');
  }
} 