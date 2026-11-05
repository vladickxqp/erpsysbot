/** What the settings page needs to know about one person's preferences. */
export const NOTIFICATION_CATEGORIES = ["assigned", "mention", "approval", "update", "insight", "failure"] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

export type Preferences = {
  favorites: string[];
  quickActions: string[];
  defaultViews: { tasks?: "board" | "list"; calendar?: "day" | "week" | "month" | "agenda" };
  notifications: { muted: NotificationCategory[]; telegram: boolean; email: boolean; frequency: "instant" | "daily"; quietFrom: string | null; quietTo: string | null };
  workHours: { from: string; to: string; days: number[] } | null;
  dismissedWidgets: string[];
};
