import { WebClient } from "@slack/web-api";
import { calendar_v3 } from "googleapis";
import { v4 as uuidv4 } from 'uuid';

import { SlackUser, CoffeeGroup } from "./types";


/**
 * Shuffles an array in place.
 * @param array Array to shuffle
 */
function shuffleArray<T>(array: T[]): T[] {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

/**
 * Fetches active, non-bot members from the specified channel.
 * Requires users:read and users:read.email scopes for email.
 */
async function getChannelMembers(client: WebClient, channelId: string): Promise<SlackUser[]> {
    try {
        const usersList: SlackUser[] = [];
        let cursor: string | undefined = undefined;

        do {
            const result = await client.conversations.members({
                channel: channelId,
                limit: 200,
                cursor: cursor,
            });

            if (!result.ok || !result.members) {
                console.error("Error fetching channel members:", result.error);
                return [];
            }

            for (const memberId of result.members) {
                // Fetch user info to get real name and email, and to filter bots
                const userInfo = await client.users.info({ user: memberId });
                if (userInfo.ok && userInfo.user && !userInfo.user.is_bot && !userInfo.user.deleted) {
                    usersList.push({
                        id: userInfo.user.id!,
                        name: userInfo.user.real_name || userInfo.user.name || memberId,
                        email: userInfo.user.profile?.email, // Needs users:read.email scope
                    });
                }
            }
            cursor = result.response_metadata?.next_cursor;
        } while (cursor);
        
        console.log(`Fetched ${usersList.length} non-bot users from channel ${channelId}.`);
        return usersList;
    } catch (error) {
        console.error("Error in getChannelMembers:", error);
        return [];
    }
}

/**
 * Creates groups of a specified size from a list of users.
 * The last group may be smaller if the total number of users is not a multiple of groupSize.
 */
function createGroups(users: SlackUser[], groupSize: number): CoffeeGroup[] {
    if (users.length === 0) return [];

    const shuffledUsers = shuffleArray([...users]);
    const groups: CoffeeGroup[] = [];
    for (let i = 0; i < shuffledUsers.length; i += groupSize) {
        const groupMembers = shuffledUsers.slice(i, i + groupSize);
        if (groupMembers.length > 0) { // Ensure no empty groups are added
             groups.push({ members: groupMembers });
        }
    }
    
    // Handle remainders: if the last group is too small (e.g., 1 person when groupSize is 4)
    // and there are other groups, try to distribute.
    // For simplicity here, we'll allow smaller final groups.
    // A more sophisticated approach might merge a single remaining user into another group.
    if (groups.length > 1) {
        const lastGroup = groups[groups.length - 1];
        const secondLastGroup = groups[groups.length - 2];
        // If last group has 1 person and other groups exist, and preferred group size > 2
        if (lastGroup.members.length === 1 && groupSize > 2 && groups.length > 1) {
             console.log(`Last group has only 1 member. Merging with the previous group.`);
             secondLastGroup.members.push(...lastGroup.members);
             groups.pop(); // Remove the last group of 1
        }
    }
    console.log(`Created ${groups.length} groups.`);
    return groups;
}

/**
 * Creates a Google Calendar event with a Meet link.
 */
async function createGoogleMeetEvent(
    group: CoffeeGroup,
    startTime: Date,
    durationMinutes: number,
    calendarApi: calendar_v3.Calendar
): Promise<{ meetLink?: string; eventId?: string; error?: string }> {
    if (!calendarApi) {
        return { error: "Google Calendar API not initialized. Cannot create event." };
    }
    if (!group.members.every(member => member.email)) {
        console.warn(`Group has members without email addresses. Event will be created without them or with fewer attendees.`);
        return { error: "Some members in the group are missing email addresses. Cannot create Google Calendar invite for all." };
    }

    const endTime = new Date(startTime.getTime() + durationMinutes * 60000);
    
    const attendees = group.members
        .filter(member => member.email) // Only include members with emails
        .map(member => ({ email: member.email! }));

    if (attendees.length === 0) {
        return { error: "No members with email addresses in this group. Cannot create event."}
    }

    const event: calendar_v3.Schema$Event = {
        summary: `Swift Coffee Chat ☕️ - ${group.members.map(m => m.name).join(', ')}`,
        description: `Your weekly random coffee chat! Participants: ${group.members.map(m => m.name).join(', ')}.`,
        start: {
            dateTime: startTime.toISOString(),
            timeZone: 'UTC', // Or your preferred timezone
        },
        end: {
            dateTime: endTime.toISOString(),
            timeZone: 'UTC',
        },
        attendees: attendees,
        conferenceData: {
            createRequest: {
                requestId: uuidv4(),
                conferenceSolutionKey: {
                    type: 'hangoutsMeet',
                },
            },
        },
        reminders: {
            useDefault: false,
            overrides: [
                { method: 'popup', minutes: 10 },
            ],
        },
    };

    try {
        const createdEvent = await calendarApi.events.insert({
            calendarId: process.env.GOOGLE_CALENDAR_ID || 'primary',
            requestBody: event,
            conferenceDataVersion: 1, // @note: important for creating the Meet Link
        });

        console.log(`Google Calendar event created: ${createdEvent.data.htmlLink}`);
        return {
            meetLink: createdEvent.data.hangoutLink || undefined,
            eventId: createdEvent.data.id || undefined,
        };
    } catch (error) {
        console.error("Error creating Google Calendar event:", error);
        return { error: `Failed to create Google Meet: ${(error as Error).message}` };
    }
}

export { getChannelMembers, createGroups, createGoogleMeetEvent };