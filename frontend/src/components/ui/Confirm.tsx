"use client";

/**
 * A promise-based confirm dialog:
 *
 *   const confirm = useConfirm();
 *   if (await confirm({ title: "Delete chat?", danger: true })) { … }
 */
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { Dialog } from "./Dialog";

export interface ConfirmOptions {
  title: string;
  message?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((ok: boolean) => void) | null>(null);

  const confirm = useCallback<ConfirmFn>((next) => {
    resolver.current?.(false); // a previous dialog that never answered
    setOptions(next);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const answer = (ok: boolean) => {
    resolver.current?.(ok);
    resolver.current = null;
    setOptions(null);
  };

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Dialog
        open={options !== null}
        onClose={() => answer(false)}
        title={options?.title ?? ""}
        description={options?.message}
        size="sm"
        footer={
          <>
            <button type="button" className="btn btn-secondary" onClick={() => answer(false)} data-autofocus>
              {options?.cancelLabel ?? "Cancel"}
            </button>
            <button
              type="button"
              className={`btn ${options?.danger ? "btn-danger" : "btn-primary"}`}
              onClick={() => answer(true)}
            >
              {options?.confirmLabel ?? "Confirm"}
            </button>
          </>
        }
      />
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmFn {
  const value = useContext(ConfirmContext);
  if (!value) throw new Error("useConfirm must be used inside <ConfirmProvider>");
  return value;
}
