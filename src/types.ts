interface SlackUser {
    id: string;
    name: string; // Real name or display name
    email?: string; // Email, crucial for Google Calendar invites
}

interface CoffeeGroup {
    members: SlackUser[];
    meetLink?: string;
    eventId?: string;
}

export { SlackUser, CoffeeGroup };