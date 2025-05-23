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
 * Handles odd numbers of members by creating slightly larger groups when necessary.
 * Ensures no single-person groups are created.
 */
function createGroups(users: SlackUser[], groupSize: number): CoffeeGroup[] {
    if (users.length === 0) return [];
    if (users.length === 1) {
        console.warn("Cannot create groups with only one user.");
        return [];
    }

    const shuffledUsers = shuffleArray([...users]);
    const groups: CoffeeGroup[] = [];
    
    // If we have an odd number of total users, we'll need to handle special cases
    const totalUsers = shuffledUsers.length;
    const remainder = totalUsers % groupSize;
    
    // Handle small group cases (2 or 3 people total)
    if (totalUsers <= 3) {
        groups.push({ members: shuffledUsers });
        return groups;
    }
    
    // Special cases handling
    if (remainder === 1) {
        // If we have one person left over, create two groups with one extra person each
        // This ensures no one is left alone
        const group1 = shuffledUsers.slice(0, groupSize + 1);
        groups.push({ members: group1 });
        
        let currentIndex = groupSize + 1;
        
        // Distribute remaining users
        while (currentIndex < shuffledUsers.length) {
            const remainingUsers = shuffledUsers.length - currentIndex;
            
            // For the last group, ensure it has at least 2 members
            if (remainingUsers < groupSize && remainingUsers < 2) {
                // Take the last person and add them to the previous group
                const lastPerson = shuffledUsers.slice(currentIndex);
                const previousGroup = groups[groups.length - 1];
                previousGroup.members = [...previousGroup.members, ...lastPerson];
                break;
            }
            
            // Otherwise create a normal sized group
            const groupMembers = shuffledUsers.slice(currentIndex, currentIndex + groupSize);
            if (groupMembers.length > 0) {
                groups.push({ members: groupMembers });
            }
            currentIndex += groupSize;
        }
    } else if (remainder === 0) {
        // Perfect division case - create groups of the standard size
        for (let i = 0; i < shuffledUsers.length; i += groupSize) {
            const groupMembers = shuffledUsers.slice(i, i + groupSize);
            if (groupMembers.length > 0) {
                groups.push({ members: groupMembers });
            }
        }
    } else {
        // For other cases (like 5 people with group size 3), distribute them more evenly
        const numStandardGroups = Math.floor(totalUsers / groupSize);
        const totalLargerGroups = remainder > numStandardGroups ? 1 : remainder;
        let currentIndex = 0;

        // Create larger groups first
        for (let i = 0; i < totalLargerGroups; i++) {
            const groupMembers = shuffledUsers.slice(currentIndex, currentIndex + groupSize + 1);
            groups.push({ members: groupMembers });
            currentIndex += groupSize + 1;
        }

        // Create remaining standard-sized groups, ensuring the last group has at least 2 people
        let remainingUsers = shuffledUsers.length - currentIndex;
        let remainingGroups = Math.ceil(remainingUsers / groupSize);
        
        // If the last group would have just 1 person, redistribute
        if (remainingUsers % groupSize === 1 && remainingGroups > 1) {
            // Create groups of size (groupSize) until we reach the last two groups
            while (currentIndex < shuffledUsers.length - (groupSize + 1)) {
                const groupMembers = shuffledUsers.slice(currentIndex, currentIndex + groupSize);
                groups.push({ members: groupMembers });
                currentIndex += groupSize;
            }
            
            // Create a final group with the remaining people (will be size groupSize+1)
            const finalGroupMembers = shuffledUsers.slice(currentIndex);
            if (finalGroupMembers.length > 0) {
                groups.push({ members: finalGroupMembers });
            }
        } else {
            // Standard distribution for the remaining users
            while (currentIndex < shuffledUsers.length) {
                const groupMembers = shuffledUsers.slice(currentIndex, currentIndex + groupSize);
                if (groupMembers.length > 0) {
                    groups.push({ members: groupMembers });
                }
                currentIndex += groupSize;
            }
        }
    }

    // Final safety check: ensure no groups of size 1
    const singlePersonGroups = groups.filter(group => group.members.length === 1);
    if (singlePersonGroups.length > 0) {
        // Redistribute single-person groups by merging them into other groups
        const validGroups = groups.filter(group => group.members.length > 1);
        const singlePersons = singlePersonGroups.flatMap(group => group.members);
        
        // Distribute single persons across existing groups
        singlePersons.forEach((person, index) => {
            if (validGroups.length > 0) {
                const targetGroupIndex = index % validGroups.length;
                validGroups[targetGroupIndex].members.push(person);
            }
        });
        
        // Replace the original groups array with our fixed groups
        groups.length = 0;
        validGroups.forEach(group => groups.push(group));
    }

    console.log(`Created ${groups.length} groups with the following sizes: ${groups.map(g => g.members.length).join(', ')}`);
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