import TeamChat from "@/components/team-chat";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/lib/supabase";

/** Team Chat for CEOs: the same group chat staff use in STM Daily. */
export default function ChatPage() {
  const { user } = useAuth();
  if (!user) return null;
  return (
    // Fill the screen below the phone header (3.5rem); the message list scrolls, not the page.
    <div className="h-[calc(100dvh-3.5rem)] lg:h-[100dvh] flex flex-col">
      <TeamChat client={supabase} me={{ id: user.id, email: user.email ?? "", role: "ceo" }} theme="light" />
    </div>
  );
}
