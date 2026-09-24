"use client";

/**
 * A dropdown menu (the WAI-ARIA "menu button" pattern).
 *
 *   <Menu label="Chat options" button={<Ellipsis />} buttonLabel="More">
 *     <MenuItem icon={Pencil} onSelect={rename}>Rename</MenuItem>
 *     <MenuItem icon={Trash2} onSelect={remove} danger>Delete</MenuItem>
 *   </Menu>
 *
 * - The panel is rendered in a portal with `position: fixed`, so it is never
 *   clipped by a scrolling sidebar.
 * - Keyboard: Arrow keys / Home / End move between items, Escape closes and
 *   returns focus to the button, Tab closes.
 * - Clicking outside, resizing, or scrolling the page closes it.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { Check } from "lucide-react";
import styles from "./Menu.module.css";

interface MenuContextValue {
  close: (focusButton?: boolean) => void;
}

const MenuContext = createContext<MenuContextValue>({ close: () => {} });

export interface MenuProps {
  /** Accessible name of the menu itself. */
  label: string;
  /** What the menu button shows. */
  button: ReactNode;
  /** aria-label for the button when it only shows an icon. */
  buttonLabel?: string;
  buttonClassName?: string;
  buttonTitle?: string;
  disabled?: boolean;
  align?: "start" | "end";
  side?: "bottom" | "top";
  /** Extra class for the panel (e.g. a wider model picker). */
  className?: string;
  children: ReactNode;
  onOpenChange?: (open: boolean) => void;
}

const ITEM_SELECTOR = '[role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"]';
const GAP = 6;
const EDGE = 8;

function menuItems(panel: HTMLElement | null): HTMLElement[] {
  return Array.from(panel?.querySelectorAll<HTMLElement>(ITEM_SELECTOR) ?? []);
}

export function Menu({
  label,
  button,
  buttonLabel,
  buttonClassName,
  buttonTitle,
  disabled,
  align = "start",
  side = "bottom",
  className,
  children,
  onOpenChange,
}: MenuProps) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<CSSProperties>({ visibility: "hidden" });
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  const setOpenState = useCallback(
    (next: boolean) => {
      setOpen(next);
      onOpenChange?.(next);
    },
    [onOpenChange],
  );

  const close = useCallback(
    (focusButton = false) => {
      setOpenState(false);
      setPosition({ visibility: "hidden" });
      if (focusButton) buttonRef.current?.focus();
    },
    [setOpenState],
  );

  // Position the panel next to the button, flipping it if it doesn't fit.
  useLayoutEffect(() => {
    if (!open) return;
    const trigger = buttonRef.current;
    const panel = panelRef.current;
    if (!trigger || !panel) return;
    const rect = trigger.getBoundingClientRect();
    const height = panel.offsetHeight;
    const width = panel.offsetWidth;
    const below = rect.bottom + GAP;
    const above = rect.top - GAP - height;
    let top = side === "top" ? above : below;
    if (side === "bottom" && below + height > window.innerHeight - EDGE && above > EDGE) top = above;
    if (side === "top" && above < EDGE) top = below;
    let left = align === "end" ? rect.right - width : rect.left;
    left = Math.max(EDGE, Math.min(left, window.innerWidth - width - EDGE));
    top = Math.max(EDGE, Math.min(top, window.innerHeight - height - EDGE));
    // Measuring the DOM before paint is exactly what layout effects are for.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPosition({ top, left });

    // Focus the checked item (radio menus) or the first item.
    const list = menuItems(panel);
    const checked = list.find((el) => el.getAttribute("aria-checked") === "true");
    (checked ?? list[0])?.focus();
  }, [open, align, side]);

  // Close on outside click, resize and page scroll.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (panelRef.current?.contains(target) || buttonRef.current?.contains(target)) return;
      close();
    };
    const onScroll = (event: Event) => {
      if (panelRef.current?.contains(event.target as Node)) return;
      close();
    };
    const onResize = () => close();
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [open, close]);

  const onPanelKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const list = menuItems(panelRef.current);
    const index = list.indexOf(document.activeElement as HTMLElement);
    const move = (to: number) => {
      event.preventDefault();
      list[(to + list.length) % list.length]?.focus();
    };
    switch (event.key) {
      case "ArrowDown":
        return move(index + 1);
      case "ArrowUp":
        return move(index <= 0 ? list.length - 1 : index - 1);
      case "Home":
        return move(0);
      case "End":
        return move(list.length - 1);
      case "Escape":
        event.preventDefault();
        event.stopPropagation();
        return close(true);
      case "Tab":
        event.preventDefault();
        return close(true);
    }
  };

  const onButtonKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if ((event.key === "ArrowDown" || event.key === "ArrowUp") && !open) {
      event.preventDefault();
      setOpenState(true);
    }
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={buttonClassName}
        aria-label={buttonLabel}
        title={buttonTitle}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        disabled={disabled}
        data-open={open || undefined}
        onClick={() => (open ? close() : setOpenState(true))}
        onKeyDown={onButtonKeyDown}
      >
        {button}
      </button>
      {open &&
        createPortal(
          <MenuContext.Provider value={{ close }}>
            <div
              ref={panelRef}
              id={menuId}
              role="menu"
              aria-label={label}
              className={`${styles.panel} ${className ?? ""}`}
              style={position}
              onKeyDown={onPanelKeyDown}
            >
              {children}
            </div>
          </MenuContext.Provider>,
          document.body,
        )}
    </>
  );
}

export interface MenuItemProps {
  children: ReactNode;
  icon?: LucideIcon;
  onSelect?: () => void;
  /** Render as a link. External links open in a new tab. */
  href?: string;
  external?: boolean;
  danger?: boolean;
  disabled?: boolean;
  /** For single-choice lists (model picker, theme). */
  checked?: boolean;
  /** Extra line under the label. */
  description?: ReactNode;
  /** Content on the right (badges, shortcuts). */
  trailing?: ReactNode;
  className?: string;
}

export function MenuItem({
  children,
  icon: Icon,
  onSelect,
  href,
  external,
  danger,
  disabled,
  checked,
  description,
  trailing,
  className,
}: MenuItemProps) {
  const { close } = useContext(MenuContext);
  const role = checked === undefined ? "menuitem" : "menuitemradio";
  const content = (
    <>
      {Icon && <Icon size={17} aria-hidden className={styles.icon} />}
      <span className={styles.text}>
        <span className={styles.label}>{children}</span>
        {description && <span className={styles.description}>{description}</span>}
      </span>
      {trailing}
      {checked && <Check size={16} aria-hidden className={styles.check} />}
    </>
  );
  const common = {
    role,
    "aria-checked": checked === undefined ? undefined : checked,
    "aria-disabled": disabled || undefined,
    tabIndex: -1,
    className: `${styles.item} ${className ?? ""}`,
    "data-danger": danger || undefined,
  };

  if (href) {
    return external ? (
      <a {...common} href={href} target="_blank" rel="noopener noreferrer" onClick={() => close()}>
        {content}
      </a>
    ) : (
      <Link {...common} href={href} onClick={() => close()}>
        {content}
      </Link>
    );
  }

  return (
    <button
      {...common}
      type="button"
      onClick={() => {
        if (disabled) return;
        close(true); // focus returns to the menu button before any dialog opens
        onSelect?.();
      }}
    >
      {content}
    </button>
  );
}

export function MenuSeparator() {
  return <div role="separator" className={styles.separator} />;
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <div className={styles.groupLabel}>{children}</div>;
}
