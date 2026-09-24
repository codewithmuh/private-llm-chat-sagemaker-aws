"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { MessageSquareText, UserRound } from "lucide-react";
import { useConfirm } from "@/components/ui/Confirm";
import { Dialog } from "@/components/ui/Dialog";
import { useToast } from "@/components/ui/Toast";
import { api, errorMessage } from "@/lib/api";
import { useChatActions } from "@/providers/ChatProvider";
import { useConversations } from "@/providers/ConversationsProvider";
import { useSession } from "@/providers/SessionProvider";
import { Section, SettingRow } from "./Section";
import styles from "./settings.module.css";

export function DataTab() {
  const router = useRouter();
  const confirm = useConfirm();
  const toast = useToast();
  const { conversations, removeAll } = useConversations();
  const { forget } = useChatActions();
  const [deletingAccount, setDeletingAccount] = useState(false);

  const deleteAllChats = async () => {
    const ok = await confirm({
      title: "Delete all chats?",
      message: `This permanently deletes all ${conversations.length} of your chats and their files. It can't be undone.`,
      confirmLabel: "Delete all",
      danger: true,
    });
    if (!ok) return;
    if (await removeAll()) {
      forget(null);
      toast.success("All chats deleted.");
      router.push("/");
    }
  };

  return (
    <>
      <Section title="Chats">
        <SettingRow
          icon={MessageSquareText}
          title="Delete all chats"
          description={`${conversations.length} chat${conversations.length === 1 ? "" : "s"} in your history.`}
          action={
            <button
              type="button"
              className="btn btn-sm btn-secondary"
              onClick={() => void deleteAllChats()}
              disabled={conversations.length === 0}
            >
              Delete all
            </button>
          }
        />
      </Section>

      <Section title="Account" danger>
        <SettingRow
          icon={UserRound}
          title="Delete account"
          description="Permanently delete your account, chats and files."
          action={
            <button type="button" className="btn btn-sm btn-danger" onClick={() => setDeletingAccount(true)}>
              Delete account
            </button>
          }
        />
      </Section>

      <Dialog open={deletingAccount} onClose={() => setDeletingAccount(false)} title="Delete your account?" size="sm">
        <DeleteAccountForm onCancel={() => setDeletingAccount(false)} />
      </Dialog>
    </>
  );
}

/**
 * DELETE /api/auth/me/ needs {password}, or {confirm: "DELETE"} for accounts
 * that sign in with Google only (they have no password).
 */
function DeleteAccountForm({ onCancel }: { onCancel: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const { user } = useSession();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ready = user.has_password ? value.length > 0 : value === "DELETE";

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      await api.del("/api/auth/me/", user.has_password ? { password: value } : { confirm: "DELETE" });
      toast.success("Your account was deleted.");
      router.replace("/login");
    } catch (err) {
      setError(errorMessage(err, "Couldn't delete your account."));
      setBusy(false);
    }
  };

  return (
    <form className={styles.stack} onSubmit={onSubmit}>
      <p className="muted" style={{ fontSize: 14 }}>
        This deletes <strong>{user.email}</strong> with all chats and uploaded files. It can&apos;t be undone.
      </p>
      {user.has_password ? (
        <input
          className="input"
          type="password"
          autoComplete="current-password"
          placeholder="Your password"
          aria-label="Your password"
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
      ) : (
        <input
          className="input"
          placeholder="Type DELETE to confirm"
          aria-label="Type DELETE to confirm"
          autoCapitalize="characters"
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
      )}
      {error && (
        <div className="alert alert-error" role="alert">
          {error}
        </div>
      )}
      <div className={styles.actions} style={{ paddingBottom: 16 }}>
        <button type="button" className="btn btn-secondary" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="btn btn-danger" disabled={!ready || busy}>
          {busy && <span className="spinner" aria-hidden />} Delete account
        </button>
      </div>
    </form>
  );
}
