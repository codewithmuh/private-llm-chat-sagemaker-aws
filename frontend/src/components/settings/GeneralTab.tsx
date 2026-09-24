"use client";

import { useState, type FormEvent } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { Field } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";
import { NO_ERRORS, toFormErrors, type FormErrors } from "@/lib/forms";
import type { ThemePreference } from "@/lib/types";
import { useModels } from "@/providers/ModelsProvider";
import { useSession } from "@/providers/SessionProvider";
import { useTheme } from "@/providers/ThemeProvider";
import { Section, SectionBody } from "./Section";
import styles from "./settings.module.css";

const THEMES: { id: ThemePreference; label: string; icon: typeof Sun }[] = [
  { id: "system", label: "System", icon: Monitor },
  { id: "light", label: "Light", icon: Sun },
  { id: "dark", label: "Dark", icon: Moon },
];

export function GeneralTab() {
  const { user, updateMe, setThemeAndSave } = useSession();
  const { theme } = useTheme();
  const { models } = useModels();
  const toast = useToast();
  const [name, setName] = useState(user.name);
  const [defaultModel, setDefaultModel] = useState(user.preferences.default_model ?? "");
  const [instructions, setInstructions] = useState(user.preferences.custom_instructions ?? "");
  const [errors, setErrors] = useState<FormErrors>(NO_ERRORS);
  const [busy, setBusy] = useState(false);

  const dirty =
    name !== user.name ||
    defaultModel !== (user.preferences.default_model ?? "") ||
    instructions !== (user.preferences.custom_instructions ?? "");

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setErrors(NO_ERRORS);
    try {
      await updateMe({
        name: name.trim(),
        preferences: { default_model: defaultModel || null, custom_instructions: instructions },
      });
      toast.success("Settings saved.");
    } catch (error) {
      setErrors(toFormErrors(error, ["name", "default_model", "custom_instructions"]));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Section title="Appearance">
        <SectionBody>
          <div className={styles.segmented} role="radiogroup" aria-label="Theme">
            {THEMES.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={theme === id}
                className={styles.segment}
                onClick={() => setThemeAndSave(id)}
              >
                <Icon size={15} aria-hidden /> {label}
              </button>
            ))}
          </div>
        </SectionBody>
      </Section>

      <form onSubmit={onSubmit}>
        <Section title="Profile & chat defaults">
          <SectionBody>
            <Field label="Name" error={errors.fields.name}>
              {(props) => (
                <input
                  {...props}
                  className="input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoComplete="name"
                />
              )}
            </Field>
            <Field label="Email" hint="Your email address can't be changed here.">
              {(props) => <input {...props} className="input" value={user.email} disabled readOnly />}
            </Field>
            <Field label="Default model" error={errors.fields.default_model} hint="Used for new chats.">
              {(props) => (
                <select
                  {...props}
                  className="select"
                  value={defaultModel}
                  onChange={(e) => setDefaultModel(e.target.value)}
                >
                  <option value="">Deployment default</option>
                  {models.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Field
              label="Custom instructions"
              error={errors.fields.custom_instructions}
              hint="Applied to every new chat. For example: “Answer briefly. I'm a Python developer.”"
            >
              {(props) => (
                <textarea
                  {...props}
                  className="textarea"
                  rows={5}
                  maxLength={4000}
                  value={instructions}
                  onChange={(e) => setInstructions(e.target.value)}
                />
              )}
            </Field>
            {errors.message && (
              <div className="alert alert-error" role="alert">
                {errors.message}
              </div>
            )}
            <div className={styles.actions}>
              <button type="submit" className="btn btn-primary" disabled={!dirty || busy}>
                {busy && <span className="spinner" aria-hidden />} Save changes
              </button>
            </div>
          </SectionBody>
        </Section>
      </form>
    </>
  );
}
