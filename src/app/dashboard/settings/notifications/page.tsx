import { cardClass } from "@/components/phase2/ui";

export default function NotificationSettings() {
  return (
    <div className={`${cardClass} border-amber-900/50`}>
      <h2 className="text-sm font-semibold text-amber-300">Blocked by configuration</h2>
      <p className="mt-2 text-sm text-mute">
        No email or messaging provider is connected, so the app cannot send notifications and no notification preferences are
        stored. Invitations are delivered as single-use links that the inviter copies and sends themselves. Once a provider
        (for example Resend or Postmark) is connected, per-user preferences and review/due-date notices can be added here.
      </p>
    </div>
  );
}
